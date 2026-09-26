import type { Config } from "../config/schema.js";
import { ExitCode } from "../core/errors.js";
import { ensureGitignore } from "../core/gitignore.js";
import { loadPrompt, renderPrompt } from "../core/prompt-loader.js";
import { displayPath } from "../core/state.js";
import {
  type Capture,
  capturedPrompt,
  clearActive,
  markActive,
  prepareCapture,
  readActive,
  readCapture,
  saveCapture,
} from "../gates/capture.js";
import { type Acceptance, newAcceptance } from "../gates/findings.js";
import { type Checks, enforceContract, type Gate, type GateRun, runGate } from "../gates/gate.js";
import {
  baselineFrom,
  runSuite,
  type SuiteBaseline,
  type SuiteCommand,
  suiteCommands,
} from "../gates/regression.js";
import { t } from "../i18n/index.js";
import { capturedTask } from "../review/run.js";
import { type AttemptOutcome, readAttempts, recordAttempt } from "../tasks/attempts.js";
import { MAX_LOG_LINES, planContext } from "../tasks/handoff.js";
import { learnFromFailure } from "../tasks/learn.js";
import { completionTimes, readMetrics } from "../tasks/metrics.js";
import { runDir, writeRunLog } from "../tasks/runs.js";
import { type Task, verificationCommands } from "../tasks/schema.js";
import { pickNext, waitingOn } from "../tasks/select.js";
import { setTaskStatus } from "../tasks/status.js";
import { findUnsafe } from "../tasks/verify.js";
import type { CommandContext } from "./context.js";
import { CLI, isAgentBackend, loadValidTasks, requireConfig, saveCommands } from "./shared.js";

export type NextOptions = { headless?: boolean; acceptFinding?: string[] };

export const MAX_RETRIES = 2;
const REVIEW_FAILURES_FOR_LESSON = 2;

export async function runNext(ctx: CommandContext, options: NextOptions): Promise<void> {
  const acceptance = newAcceptance(options.acceptFinding);
  await recoverInterrupted(ctx, acceptance);
  const stored = await requireConfig(ctx);
  ctx.prompter.intro(t("next.intro"));
  const config = await withSuiteCommands(ctx, stored);
  const tasks = await loadValidTasks(ctx);
  const task = pickNext(tasks);
  if (!task) {
    reportNoTask(ctx, tasks);
    return;
  }
  ctx.prompter.note(
    describeTask(task, checksFor(task, config)),
    `${task.meta.id} · ${task.meta.title}`,
  );
  if (ctx.flags.dryRun) {
    ctx.print(`${task.text}\n`);
    ctx.prompter.outro(t("next.dryRunDone"));
    return;
  }
  const capture = await start(ctx, config, task);
  const run: GateRun = {
    capture,
    checks: checksFor(capturedTask(capture), capture.config),
    approval: { granted: false },
    acceptance,
  };
  const prompt = await taskPrompt(ctx, capture, tasks);
  const headless = Boolean(options.headless) && isAgentBackend(capture.config.backend);
  if (options.headless && !headless) ctx.prompter.warn(t("next.headlessNeedsAgent"));
  const done = headless
    ? await headlessLoop(ctx, run, prompt)
    : await attemptOnce(ctx, run, prompt);
  if (!done) throw new ExitCode(1);
}

async function recoverInterrupted(ctx: CommandContext, acceptance: Acceptance): Promise<void> {
  const id = await readActive(ctx.cwd);
  if (!id) return;
  const capture = await readCapture(ctx.cwd, id);
  await clearActive(ctx.cwd);
  if (!capture) return;
  const contract = await enforceContract(ctx, capture, acceptance);
  if (contract.blocked) ctx.prompter.warn(t("contract.recovered", { id }));
}

function checksFor(task: Task, config: Config): Checks {
  return { commands: verificationCommands(task.body), suite: suiteCommands(config) };
}

async function start(ctx: CommandContext, config: Config, task: Task): Promise<Capture> {
  await ensureGitignore(ctx.cwd);
  const previous = await readCapture(ctx.cwd, task.meta.id);
  const started = await setTaskStatus(ctx.cwd, task, "in_progress");
  const capture = await prepareCapture(ctx.cwd, config, started);
  const fresh = !previous || previous.finished;
  if (fresh && task.meta.status === "in_progress") {
    ctx.prompter.warn(t("capture.late", { id: task.meta.id }));
    capture.late = true;
  }
  if (config.gates.regression === "full" && capture.baseline === undefined) {
    const baseline = await recordBaseline(ctx, suiteCommands(config));
    if (baseline) capture.baseline = baseline;
  }
  await saveCapture(ctx.cwd, capture);
  return capture;
}

async function withSuiteCommands(ctx: CommandContext, config: Config): Promise<Config> {
  if (config.gates.regression === "off" || config.commands.test || config.commands.lint) {
    return config;
  }
  const commands = await saveCommands(ctx);
  if (!commands.test && !commands.lint) ctx.prompter.info(t("regression.noCommands"));
  return { ...config, commands };
}

async function recordBaseline(
  ctx: CommandContext,
  suite: SuiteCommand[],
): Promise<SuiteBaseline | undefined> {
  if (suite.length === 0 || findUnsafe(suite.map((item) => item.command)).length > 0) {
    return undefined;
  }
  ctx.prompter.note(
    suite.map((item) => `$ ${item.command}`).join("\n"),
    t("regression.baselineTitle"),
  );
  if (!ctx.flags.yes && !(await ctx.prompter.confirm(t("regression.confirm"), true))) {
    ctx.prompter.warn(t("regression.skipped"));
    return { skipped: true, exitCodes: {} };
  }
  const results = await runSuite(ctx.cwd, suite, ctx.print);
  for (const result of results.filter((item) => item.exitCode !== 0)) {
    ctx.prompter.warn(
      t("regression.preexisting", { command: result.command, code: result.exitCode }),
    );
  }
  return baselineFrom(results);
}

async function runAgent(
  ctx: CommandContext,
  run: GateRun,
  launch: () => Promise<unknown>,
): Promise<void> {
  await markActive(ctx.cwd, run.capture.id);
  try {
    await launch();
  } catch (error) {
    await enforceContract(ctx, run.capture, run.acceptance);
    await clearActive(ctx.cwd);
    throw error;
  }
  await setTaskStatus(ctx.cwd, capturedTask(run.capture), "in_progress");
}

async function gate(ctx: CommandContext, run: GateRun): Promise<Gate> {
  const result = await runGate(ctx, run);
  await clearActive(ctx.cwd);
  return result;
}

async function attemptOnce(ctx: CommandContext, run: GateRun, prompt: string): Promise<boolean> {
  const { capture } = run;
  const backend = ctx.createBackend(
    isAgentBackend(capture.config.backend) ? capture.config.backend : "manual",
  );
  ctx.prompter.info(t("next.launching", { backend: backend.name }));
  const startedAt = new Date();
  await runAgent(ctx, run, () => backend.run(prompt, { cwd: ctx.cwd, interactive: true }));
  const result = await gate(ctx, run);
  await writeRunLog(ctx.cwd, capture.id, result.report);
  await record(ctx, capture, result, startedAt, false, result.passed ? "done" : "failed");
  if (result.passed) return complete(ctx, capture);
  await learnFromReviews(ctx, capture, result);
  ctx.prompter.outro(t("next.notDone", { id: capture.id, command: `${CLI} next` }));
  return false;
}

async function headlessLoop(ctx: CommandContext, run: GateRun, first: string): Promise<boolean> {
  const { capture } = run;
  const backend = ctx.createBackend(capture.config.backend);
  let prompt = first;
  const max = MAX_RETRIES + 1;
  for (let attempt = 1; attempt <= max; attempt++) {
    ctx.prompter.info(t("next.attempt", { attempt, max, backend: backend.name }));
    const startedAt = new Date();
    await runAgent(ctx, run, () =>
      backend.run(prompt, { cwd: ctx.cwd, access: "edit", stream: ctx.print }),
    );
    const result = await gate(ctx, run);
    await writeRunLog(ctx.cwd, capture.id, `# Attempt ${attempt}\n\n${result.report}`);
    const exhausted = !result.passed && result.retryable && attempt === max;
    const outcome = result.passed ? "done" : exhausted ? "blocked" : "failed";
    await record(ctx, capture, result, startedAt, true, outcome);
    if (result.passed) return complete(ctx, capture);
    if (!result.retryable) {
      ctx.prompter.outro(t("next.notDone", { id: capture.id, command: `${CLI} next` }));
      return false;
    }
    if (exhausted) break;
    await learnFromReviews(ctx, capture, result);
    prompt = renderPrompt(capturedPrompt(capture, "retry"), {
      task: capture.task,
      failure: result.report,
      attempt: String(attempt),
      task_path: capture.path,
      max_log_lines: String(MAX_LOG_LINES),
    });
  }
  await setTaskStatus(ctx.cwd, capturedTask(capture), "blocked");
  await learnFromFailure(ctx, capture, "blocked");
  ctx.prompter.outro(
    t("next.blocked", { id: capture.id, path: displayPath(runDir(ctx.cwd, capture.id)) }),
  );
  return false;
}

async function record(
  ctx: CommandContext,
  capture: Capture,
  result: Gate,
  startedAt: Date,
  headless: boolean,
  outcome: AttemptOutcome,
): Promise<void> {
  await recordAttempt(ctx.cwd, capture.id, {
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    headless,
    outcome,
    ...(result.stage ? { stage: result.stage } : {}),
    regressions: result.regressions,
  });
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

async function taskPrompt(ctx: CommandContext, capture: Capture, tasks: Task[]): Promise<string> {
  const task = capturedTask(capture);
  const others = tasks.map((item) => (item.meta.id === task.meta.id ? task : item));
  const metrics = await readMetrics(
    ctx.cwd,
    others.filter((item) => item.meta.status === "done").map((item) => item.meta.id),
  );
  return renderPrompt(await loadPrompt("task", ctx.cwd), {
    context: planContext(capture.config, others, task, completionTimes(metrics)),
    task: task.text.trim(),
    task_path: task.path,
    max_log_lines: String(MAX_LOG_LINES),
    suite:
      suiteCommands(capture.config).length > 0
        ? ", then the project's lint and test commands, which must not turn red"
        : "",
  });
}

function describeTask(task: Task, checks: Checks): string {
  const { phase, size, risk, depends_on } = task.meta;
  const deps = depends_on.length > 0 ? depends_on.join(", ") : "-";
  const verify = checks.commands.map((command) => `  $ ${command}`).join("\n");
  const lines = [t("next.meta", { phase, size, risk, deps }), `${t("verify.commands")}:`, verify];
  if (checks.suite.length > 0) {
    lines.push(`${t("regression.title")}:`, ...checks.suite.map((item) => `  $ ${item.command}`));
  }
  return lines.join("\n");
}

function reportNoTask(ctx: CommandContext, tasks: Task[]): void {
  if (tasks.length === 0) {
    ctx.prompter.outro(t("next.noPlan", { command: `${CLI} plan` }));
    return;
  }
  if (tasks.every((task) => task.meta.status === "done")) {
    ctx.prompter.outro(t("next.allDone"));
    return;
  }
  const stuck = tasks
    .filter((task) => task.meta.status !== "done")
    .map((task) => {
      const waiting = waitingOn(task, tasks);
      const reason =
        task.meta.status === "blocked" ? "blocked" : `waiting on ${waiting.join(", ")}`;
      return `${task.meta.id} ${task.meta.title} (${reason})`;
    });
  ctx.prompter.note(stuck.join("\n"), t("next.nothingReady"));
  ctx.prompter.outro(t("next.unblock"));
}
