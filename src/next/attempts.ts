import pc from "picocolors";
import type { Progress } from "../backends/types.js";
import type { CommandContext } from "../commands/context.js";
import { CLI, isAgentBackend } from "../commands/shared.js";
import { EnvironmentError, UserError } from "../core/errors.js";
import { renderPrompt } from "../core/prompt-loader.js";
import { displayPath } from "../core/state.js";
import { costSince, formatCost, mark, type UsageMark } from "../core/usage.js";
import {
  type Capture,
  capturedPrompt,
  clearActive,
  markActive,
  saveCapture,
} from "../gates/capture.js";
import { enforceContract } from "../gates/enforce.js";
import { type Gate, type GateRun, runGate } from "../gates/gate.js";
import { guardState } from "../gates/state-guard.js";
import { t } from "../i18n/index.js";
import { taskChanges } from "../review/changes.js";
import { capturedTask } from "../review/run.js";
import {
  type Attempt,
  attemptsLeft,
  type GateStage,
  MAX_ATTEMPTS,
  readAttempts,
  recordAttempt,
  recordStop,
} from "../tasks/attempts.js";
import { MAX_LOG_LINES } from "../tasks/handoff.js";
import { learnFromFailure } from "../tasks/learn.js";
import { loadTaskFiles } from "../tasks/load.js";
import { formatDuration } from "../tasks/metrics.js";
import { runDir, writeRunLog } from "../tasks/runs.js";
import { setTaskStatus } from "../tasks/status.js";
import { describeProgress } from "../ui/progress.js";
import { announcePullRequest } from "./branch.js";
import { commitTask } from "./commit.js";
import { affectsChecks, agentCommands, briefCommands, ruleHint } from "./permissions.js";

const REVIEW_FAILURES_FOR_LESSON = 2;

type Launched = { ok: true } | { ok: false; reason: string; environment: boolean };

export async function attemptOnce(
  ctx: CommandContext,
  run: GateRun,
  prompt: string,
): Promise<boolean> {
  const { capture } = run;
  const backend = ctx.createBackend(
    isAgentBackend(capture.config.backend) ? capture.config.backend : "manual",
  );
  ctx.prompter.info(t("next.launching", { backend: backend.name }));
  const startedAt = begin(ctx);
  const launched = await launch(ctx, run, startedAt, false, () =>
    backend.run(prompt, { cwd: ctx.cwd, interactive: true }),
  );
  if (!launched.ok) {
    return launched.environment
      ? stop(ctx, capture, "agent", launched.reason)
      : notDone(ctx, capture);
  }
  if (await changedNothing(ctx, run)) {
    return stop(ctx, capture, "agent", t("next.noChanges", { id: capture.id }));
  }
  const result = await gate(ctx, run);
  await writeRunLog(ctx.cwd, capture.id, result.report);
  if (result.environment) return stop(ctx, capture, result.stage ?? "agent", result.environment);
  const outcome = result.passed ? "done" : result.stage === "refused" ? "blocked" : "failed";
  await record(ctx, run, startedAt, false, { outcome, gate: result });
  if (result.passed) return complete(ctx, run);
  if (outcome === "blocked") return block(ctx, capture, result.reason ?? "");
  await learnFromReviews(ctx, capture, result);
  return notDone(ctx, capture);
}

export async function headlessLoop(
  ctx: CommandContext,
  run: GateRun,
  first: string,
): Promise<boolean> {
  const { capture } = run;
  const backend = ctx.createBackend(capture.config.backend);
  let left = await attemptsLeft(ctx.cwd, capture.id);
  if (left === 0) {
    const reason = t("next.budgetUsed", { max: MAX_ATTEMPTS });
    await record(ctx, run, new Date(), true, { outcome: "blocked", reason });
    return block(ctx, capture, reason);
  }
  let prompt = first;
  let attempt = MAX_ATTEMPTS - left;
  const timeoutMs = capture.config.agent.timeoutMinutes * 60_000;
  const allow = agentCommands(capture.config, capturedTask(capture));
  while (left > 0) {
    attempt++;
    left--;
    ctx.prompter.info(t("next.attempt", { attempt, max: MAX_ATTEMPTS, backend: backend.name }));
    const startedAt = begin(ctx);
    const denied: string[] = [];
    const launched = await launch(
      ctx,
      run,
      startedAt,
      true,
      () =>
        backend.run(prompt, {
          cwd: ctx.cwd,
          access: "edit",
          stream: ctx.print,
          timeoutMs,
          allow,
          onInfo: (info) => denied.push(...(info.denied ?? [])),
          onProgress: (progress) => showStep(ctx, progress),
        }),
      left === 0,
    );
    if (!launched.ok) {
      if (launched.environment) return stop(ctx, capture, "agent", launched.reason);
      return left === 0 ? block(ctx, capture, launched.reason) : notDone(ctx, capture);
    }
    if (await changedNothing(ctx, run)) {
      const reason = t("next.noChanges", { id: capture.id });
      ctx.prompter.warn(reason);
      await record(ctx, run, startedAt, true, {
        outcome: left === 0 ? "blocked" : "failed",
        stage: "agent",
        reason,
      });
      return left === 0 ? block(ctx, capture, reason) : notDone(ctx, capture);
    }
    const result = await gate(ctx, run);
    await writeRunLog(ctx.cwd, capture.id, `# Attempt ${attempt}\n\n${result.report}`);
    const cause = result.passed ? undefined : environmentCause(backend.name, denied, result);
    if (cause) return stop(ctx, capture, result.stage ?? "agent", cause);
    const blocked =
      !result.passed && (result.stage === "refused" || (result.retryable && left === 0));
    const outcome = result.passed ? "done" : blocked ? "blocked" : "failed";
    await record(ctx, run, startedAt, true, { outcome, gate: result });
    if (result.passed) return complete(ctx, run);
    if (blocked) return block(ctx, capture, result.reason ?? "");
    if (!result.retryable) return notDone(ctx, capture);
    await learnFromReviews(ctx, capture, result);
    prompt = renderPrompt(capturedPrompt(capture, "retry"), {
      task: capture.task,
      failure: result.report,
      attempt: String(attempt),
      task_path: capture.path,
      max_log_lines: String(MAX_LOG_LINES),
      permissions: permissionNote(capture),
    });
  }
  return false;
}

export function permissionNote(capture: Capture): string {
  const commands = briefCommands(agentCommands(capture.config, capturedTask(capture)));
  if (commands.length === 0) return "";
  const list = commands.map((command) => `\`${command}\``).join(", ");
  return `\n\nThis run is unattended, so nobody can approve a command. You may run these commands, with any arguments: ${list}. Any other command will be denied. One denied command does not mean the others are: if one is refused, keep going with the ones above, for example install dependencies even if a version check was refused.`;
}

async function launch(
  ctx: CommandContext,
  run: GateRun,
  startedAt: Date,
  headless: boolean,
  go: () => Promise<unknown>,
  final = false,
): Promise<Launched> {
  await markActive(ctx.cwd, run.capture.id);
  const guard = await guardState(ctx.cwd);
  let failure: unknown;
  let failed = false;
  try {
    await go();
  } catch (error) {
    failure = error;
    failed = true;
  }
  run.tampered.push(...(await guard.verify()));
  await setTaskStatus(ctx.cwd, capturedTask(run.capture), "in_progress");
  if (!failed) return { ok: true };
  await enforceContract(ctx, run.capture, run.acceptance);
  await clearActive(ctx.cwd);
  const reason = failure instanceof Error ? failure.message : String(failure);
  const environment = failure instanceof EnvironmentError;
  if (!environment) {
    const outcome = final ? "blocked" : "failed";
    await record(ctx, run, startedAt, headless, { outcome, stage: "agent", reason });
  }
  if (!(failure instanceof UserError)) throw failure;
  if (!environment) ctx.prompter.warn(reason);
  return { ok: false, reason, environment };
}

async function changedNothing(ctx: CommandContext, run: GateRun): Promise<boolean> {
  const view = await taskChanges(ctx.cwd, run.capture);
  if (!view.ok || view.changes.files.length > 0 || view.late.length > 0) return false;
  run.tampered.splice(0);
  await enforceContract(ctx, run.capture, run.acceptance);
  await clearActive(ctx.cwd);
  return true;
}

async function gate(ctx: CommandContext, run: GateRun): Promise<Gate> {
  const result = await runGate(ctx, run);
  await clearActive(ctx.cwd);
  return result;
}

const marks = new WeakMap<Date, UsageMark>();

function begin(ctx: CommandContext): Date {
  const startedAt = new Date();
  marks.set(startedAt, mark(ctx.usage));
  return startedAt;
}

function showStep(ctx: CommandContext, progress: Progress): void {
  if (progress.type !== "tool") return;
  const step = describeProgress(progress);
  if (step) ctx.print(`${pc.dim(`  · ${step}`)}\n`);
}

type Outcome = {
  outcome: Attempt["outcome"];
  gate?: Gate;
  stage?: Attempt["stage"];
  reason?: string;
};

async function record(
  ctx: CommandContext,
  run: GateRun,
  startedAt: Date,
  headless: boolean,
  result: Outcome,
): Promise<void> {
  const stage = result.gate?.stage ?? result.stage;
  const reason = result.gate?.reason ?? result.reason;
  const skips = result.gate?.skips ?? [];
  const accepted = run.acceptance.accepted.flatMap((finding) => (finding.id ? [finding.id] : []));
  const durationMs = Date.now() - startedAt.getTime();
  const from = marks.get(startedAt);
  const costUsd = from ? costSince(ctx.usage, from) : undefined;
  if (from) {
    const cost = costUsd === undefined ? t("next.costUnknown") : formatCost(costUsd);
    ctx.prompter.info(t("next.attemptUsage", { time: formatDuration(durationMs), cost }));
  }
  await recordAttempt(ctx.cwd, run.capture.id, {
    startedAt: startedAt.toISOString(),
    durationMs,
    ...(costUsd === undefined ? {} : { costUsd }),
    headless,
    outcome: result.outcome,
    ...(stage ? { stage } : {}),
    regressions: result.gate?.regressions ?? [],
    ...(reason ? { reason } : {}),
    ...(skips.length > 0 ? { skips } : {}),
    ...(accepted.length > 0 ? { accepted } : {}),
  });
}

async function block(ctx: CommandContext, capture: Capture, reason: string): Promise<boolean> {
  await setTaskStatus(ctx.cwd, capturedTask(capture), "blocked");
  await learnFromFailure(ctx, capture, "blocked");
  const path = displayPath(runDir(ctx.cwd, capture.id));
  const task = capture.path;
  ctx.prompter.outro(
    t("next.blocked", { id: capture.id, path, reason, task, command: `${CLI} next` }),
  );
  return false;
}

function notDone(ctx: CommandContext, capture: Capture): boolean {
  ctx.prompter.outro(t("next.notDone", { id: capture.id, command: `${CLI} next` }));
  return false;
}

async function stop(
  ctx: CommandContext,
  capture: Capture,
  stage: GateStage,
  reason: string,
): Promise<boolean> {
  await recordStop(ctx.cwd, capture.id, { at: new Date().toISOString(), stage, reason });
  await writeRunLog(ctx.cwd, capture.id, `# ${t("next.stoppedTitle")}\n\n${reason}`);
  ctx.prompter.outro(t("next.stopped", { id: capture.id, reason, command: `${CLI} next` }));
  return false;
}

async function learnFromReviews(ctx: CommandContext, capture: Capture, result: Gate) {
  if (result.stage !== "review") return;
  const failures = (await readAttempts(ctx.cwd, capture.id)).filter(
    (attempt) => attempt.stage === "review",
  );
  if (failures.length >= REVIEW_FAILURES_FOR_LESSON) {
    await learnFromFailure(ctx, capture, "review");
  }
}

async function complete(ctx: CommandContext, run: GateRun): Promise<boolean> {
  const { capture } = run;
  const task = capturedTask(capture);
  await setTaskStatus(ctx.cwd, task, "done");
  await saveCapture(ctx.cwd, { ...capture, finished: true });
  if (!ctx.flags.dryRun) await commitTask(ctx, capture, task.meta, { verify: run.verify });
  if (await everyTaskDone(ctx.cwd)) await announcePullRequest(ctx);
  ctx.prompter.outro(t("next.done", { id: capture.id, command: `${CLI} next` }));
  return true;
}

async function everyTaskDone(cwd: string): Promise<boolean> {
  const tasks = await loadTaskFiles(cwd);
  return tasks.length > 0 && tasks.every((item) => item.task?.meta.status === "done");
}

const CHECK_STAGES = new Set(["regression", "verification"]);

const SHOWN_DENIALS = 3;
const DENIAL_CHARS = 80;

function environmentCause(agent: string, denied: string[], result: Gate): string | undefined {
  const needed = denied.filter(affectsChecks);
  const commands = listDenials(needed);
  if (result.environment) {
    return needed.length > 0
      ? `${result.environment} ${t("env.alsoDenied", { agent, commands })}`
      : result.environment;
  }
  if (needed.length === 0 || !CHECK_STAGES.has(result.stage ?? "")) return undefined;
  return t("env.denied", { agent, commands, first: ruleHint(needed[0] ?? "") });
}

function listDenials(denied: string[]): string {
  const shown = denied.slice(0, SHOWN_DENIALS).map((command) => {
    const line = command.replace(/\s+/g, " ").trim();
    return `\`${line.length > DENIAL_CHARS ? `${line.slice(0, DENIAL_CHARS - 1)}…` : line}\``;
  });
  const more = denied.length - shown.length;
  return more > 0
    ? `${shown.join(", ")} ${t("env.moreDenied", { count: more })}`
    : shown.join(", ");
}
