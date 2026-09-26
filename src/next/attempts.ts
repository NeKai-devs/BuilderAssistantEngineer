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
import { runDir, writeRunLog } from "../tasks/runs.js";
import { setTaskStatus } from "../tasks/status.js";

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
  if (!launched.ok) return notDone(ctx, capture, launched.reason);
  const result = await gate(ctx, run);
  await writeRunLog(ctx.cwd, capture.id, result.report);
  const outcome = result.passed ? "done" : result.stage === "refused" ? "blocked" : "failed";
  await record(ctx, run, startedAt, false, { outcome, gate: result });
  if (result.passed) return complete(ctx, capture);
  if (outcome === "blocked") return block(ctx, capture, result.reason ?? "");
  await learnFromReviews(ctx, capture, result);
  return notDone(ctx, capture, result.reason);
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
  while (left > 0) {
    attempt++;
    left--;
    ctx.prompter.info(t("next.attempt", { attempt, max: MAX_ATTEMPTS, backend: backend.name }));
    const startedAt = new Date();
    const launched = await launch(ctx, run, startedAt, true, () =>
      backend.run(prompt, { cwd: ctx.cwd, access: "edit", stream: ctx.print, timeoutMs }),
    );
    if (!launched.ok) {
      return left === 0
        ? block(ctx, capture, launched.reason)
        : notDone(ctx, capture, launched.reason);
    }
    const result = await gate(ctx, run);
    await writeRunLog(ctx.cwd, capture.id, `# Attempt ${attempt}\n\n${result.report}`);
    const blocked =
      !result.passed && (result.stage === "refused" || (result.retryable && left === 0));
    const outcome = result.passed ? "done" : blocked ? "blocked" : "failed";
    await record(ctx, run, startedAt, true, { outcome, gate: result });
    if (result.passed) return complete(ctx, capture);
    if (blocked) return block(ctx, capture, result.reason ?? "");
    if (!result.retryable) return notDone(ctx, capture, result.reason);
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
): Promise<Launched> {
  await markActive(ctx.cwd, run.capture.id);
  try {
    await go();
  } catch (error) {
    await enforceContract(ctx, run.capture, run.acceptance);
    await clearActive(ctx.cwd);
    const reason = error instanceof Error ? error.message : String(error);
    await record(ctx, run, startedAt, headless, { outcome: "failed", stage: "agent", reason });
    if (!(error instanceof UserError)) throw error;
    ctx.prompter.warn(reason);
    return { ok: false, reason };
  }
  await setTaskStatus(ctx.cwd, capturedTask(run.capture), "in_progress");
  return { ok: true };
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

async function block(ctx: CommandContext, capture: Capture, reason: string): Promise<boolean> {
  await setTaskStatus(ctx.cwd, capturedTask(capture), "blocked");
  await learnFromFailure(ctx, capture, "blocked");
  const path = displayPath(runDir(ctx.cwd, capture.id));
  ctx.prompter.outro(t("next.blocked", { id: capture.id, path, reason }));
  return false;
}

function notDone(ctx: CommandContext, capture: Capture, reason?: string): boolean {
  if (reason) ctx.prompter.info(reason);
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

async function complete(ctx: CommandContext, capture: Capture): Promise<boolean> {
  await setTaskStatus(ctx.cwd, capturedTask(capture), "done");
  await saveCapture(ctx.cwd, { ...capture, finished: true });
  ctx.prompter.outro(t("next.done", { id: capture.id, command: `${CLI} next` }));
  return true;
}
