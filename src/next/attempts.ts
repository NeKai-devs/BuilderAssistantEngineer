import type { CommandContext } from "../commands/context.js";
import { CLI, isAgentBackend } from "../commands/shared.js";
import { UserError } from "../core/errors.js";
import { renderPrompt } from "../core/prompt-loader.js";
import { displayPath } from "../core/state.js";
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
import { capturedTask } from "../review/run.js";
import {
  type Attempt,
  attemptsLeft,
  MAX_ATTEMPTS,
  readAttempts,
  recordAttempt,
} from "../tasks/attempts.js";
import { MAX_LOG_LINES } from "../tasks/handoff.js";
import { learnFromFailure } from "../tasks/learn.js";
import { loadTaskFiles } from "../tasks/load.js";
import { runDir, writeRunLog } from "../tasks/runs.js";
import { setTaskStatus } from "../tasks/status.js";
import { announcePullRequest } from "./branch.js";
import { commitTask } from "./commit.js";
import { affectsChecks, agentCommands, ruleHint } from "./permissions.js";

const REVIEW_FAILURES_FOR_LESSON = 2;

type Launched = { ok: true } | { ok: false; reason: string };

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
  const startedAt = new Date();
  const launched = await launch(ctx, run, startedAt, false, () =>
    backend.run(prompt, { cwd: ctx.cwd, interactive: true }),
  );
  if (!launched.ok) return notDone(ctx, capture);
  const result = await gate(ctx, run);
  await writeRunLog(ctx.cwd, capture.id, result.report);
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
    const startedAt = new Date();
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
        }),
      left === 0,
    );
    if (!launched.ok) {
      return left === 0 ? block(ctx, capture, launched.reason) : notDone(ctx, capture);
    }
    const result = await gate(ctx, run);
    await writeRunLog(ctx.cwd, capture.id, `# Attempt ${attempt}\n\n${result.report}`);
    const cause = result.passed ? undefined : environmentCause(backend.name, denied, result);
    const blocked =
      !result.passed &&
      (cause !== undefined || result.stage === "refused" || (result.retryable && left === 0));
    const outcome = result.passed ? "done" : blocked ? "blocked" : "failed";
    const recorded = cause ? { ...result, reason: cause } : result;
    await record(ctx, run, startedAt, true, { outcome, gate: recorded });
    if (result.passed) return complete(ctx, run);
    if (cause) return block(ctx, capture, cause, false);
    if (blocked) return block(ctx, capture, result.reason ?? "");
    if (!result.retryable) return notDone(ctx, capture);
    await learnFromReviews(ctx, capture, result);
    prompt = renderPrompt(capturedPrompt(capture, "retry"), {
      task: capture.task,
      failure: result.report,
      attempt: String(attempt),
      task_path: capture.path,
      max_log_lines: String(MAX_LOG_LINES),
    });
  }
  return false;
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
  const outcome = final ? "blocked" : "failed";
  await record(ctx, run, startedAt, headless, { outcome, stage: "agent", reason });
  if (!(failure instanceof UserError)) throw failure;
  ctx.prompter.warn(reason);
  return { ok: false, reason };
}

async function gate(ctx: CommandContext, run: GateRun): Promise<Gate> {
  const result = await runGate(ctx, run);
  await clearActive(ctx.cwd);
  return result;
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
  await recordAttempt(ctx.cwd, run.capture.id, {
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    headless,
    outcome: result.outcome,
    ...(stage ? { stage } : {}),
    regressions: result.gate?.regressions ?? [],
    ...(reason ? { reason } : {}),
    ...(skips.length > 0 ? { skips } : {}),
    ...(accepted.length > 0 ? { accepted } : {}),
  });
}

async function block(
  ctx: CommandContext,
  capture: Capture,
  reason: string,
  learn = true,
): Promise<boolean> {
  await setTaskStatus(ctx.cwd, capturedTask(capture), "blocked");
  if (learn) await learnFromFailure(ctx, capture, "blocked");
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
