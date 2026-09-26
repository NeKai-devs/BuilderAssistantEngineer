import type { Config } from "../config/schema.js";
import { ExitCode } from "../core/errors.js";
import { headCommit } from "../core/git.js";
import { ensureGitignore } from "../core/gitignore.js";
import { loadPrompt, renderPrompt } from "../core/prompt-loader.js";
import { type Approval, type Checks, type Gate, runGate } from "../gates/gate.js";
import {
  baselineFrom,
  runSuite,
  type SuiteCommand,
  saveSuiteBaseline,
  suiteCommands,
} from "../gates/regression.js";
import { t } from "../i18n/index.js";
import { type AttemptOutcome, readAttempts, recordAttempt } from "../tasks/attempts.js";
import { MAX_LOG_LINES, planContext } from "../tasks/handoff.js";
import { learnFromFailure } from "../tasks/learn.js";
import { completionTimes, readMetrics } from "../tasks/metrics.js";
import { readBase, saveBase, writeRunLog } from "../tasks/runs.js";
import { type Task, verificationCommands } from "../tasks/schema.js";
import { pickNext, waitingOn } from "../tasks/select.js";
import { setTaskStatus } from "../tasks/status.js";
import { findUnsafe } from "../tasks/verify.js";
import type { CommandContext } from "./context.js";
import { CLI, isAgentBackend, loadValidTasks, requireConfig } from "./shared.js";

export type NextOptions = { headless?: boolean };

export const MAX_RETRIES = 2;
const REVIEW_FAILURES_FOR_LESSON = 2;

export async function runNext(ctx: CommandContext, options: NextOptions): Promise<void> {
  const config = await requireConfig(ctx);
  ctx.prompter.intro(t("next.intro"));
  const tasks = await loadValidTasks(ctx);
  const task = pickNext(tasks);
  if (!task) {
    reportNoTask(ctx, tasks);
    return;
  }
  const checks: Checks = {
    commands: verificationCommands(task.body),
    suite: suiteCommands(config),
  };
  ctx.prompter.note(describeTask(task, checks), `${task.meta.id} · ${task.meta.title}`);
  if (ctx.flags.dryRun) {
    ctx.print(`${task.text}\n`);
    ctx.prompter.outro(t("next.dryRunDone"));
    return;
  }
  const started = await start(ctx, config, task, checks.suite);
  const prompt = await taskPrompt(ctx, config, started, tasks);
  const headless = Boolean(options.headless) && isAgentBackend(config.backend);
  if (options.headless && !headless) ctx.prompter.warn(t("next.headlessNeedsAgent"));
  const done = headless
    ? await headlessLoop(ctx, config, started, checks, prompt)
    : await attemptOnce(ctx, config, started, checks, prompt);
  if (!done) throw new ExitCode(1);
}

async function start(
  ctx: CommandContext,
  config: Config,
  task: Task,
  suite: SuiteCommand[],
): Promise<Task> {
  await ensureGitignore(ctx.cwd);
  if (!(await readBase(ctx.cwd, task.meta.id))) {
    const head = await headCommit(ctx.cwd);
    if (head) await saveBase(ctx.cwd, task.meta.id, head);
  }
  if (task.meta.status === "pending" && config.gates.regression === "full") {
    await recordBaseline(ctx, task, suite);
  }
  return task.meta.status === "in_progress" ? task : setTaskStatus(ctx.cwd, task, "in_progress");
}

async function recordBaseline(ctx: CommandContext, task: Task, suite: SuiteCommand[]) {
  if (suite.length === 0 || findUnsafe(suite.map((item) => item.command)).length > 0) return;
  ctx.prompter.note(
    suite.map((item) => `$ ${item.command}`).join("\n"),
    t("regression.baselineTitle"),
  );
  if (!ctx.flags.yes && !(await ctx.prompter.confirm(t("regression.confirm"), true))) {
    await saveSuiteBaseline(ctx.cwd, task.meta.id, { skipped: true, exitCodes: {} });
    ctx.prompter.warn(t("regression.skipped"));
    return;
  }
  const results = await runSuite(ctx.cwd, suite, ctx.print);
  for (const result of results.filter((item) => item.exitCode !== 0)) {
    ctx.prompter.warn(
      t("regression.preexisting", { command: result.command, code: result.exitCode }),
    );
  }
  await saveSuiteBaseline(ctx.cwd, task.meta.id, baselineFrom(results));
}

async function attemptOnce(
  ctx: CommandContext,
  config: Config,
  task: Task,
  checks: Checks,
  prompt: string,
): Promise<boolean> {
  const backend = ctx.createBackend(isAgentBackend(config.backend) ? config.backend : "manual");
  ctx.prompter.info(t("next.launching", { backend: backend.name }));
  const startedAt = new Date();
  await backend.run(prompt, { cwd: ctx.cwd, interactive: true });
  await setTaskStatus(ctx.cwd, task, "in_progress");
  const gate = await runGate(ctx, config, task, checks, { granted: false });
  await writeRunLog(ctx.cwd, task.meta.id, gate.report);
  await record(ctx, task, gate, startedAt, false, gate.passed ? "done" : "failed");
  if (gate.passed) return complete(ctx, task);
  await learnFromReviews(ctx, config, task, gate);
  ctx.prompter.outro(t("next.notDone", { id: task.meta.id, command: `${CLI} next` }));
  return false;
}

async function headlessLoop(
  ctx: CommandContext,
  config: Config,
  task: Task,
  checks: Checks,
  first: string,
): Promise<boolean> {
  const backend = ctx.createBackend(config.backend);
  const approval: Approval = { granted: false };
  let prompt = first;
  const max = MAX_RETRIES + 1;
  for (let attempt = 1; attempt <= max; attempt++) {
    ctx.prompter.info(t("next.attempt", { attempt, max, backend: backend.name }));
    const startedAt = new Date();
    await backend.run(prompt, { cwd: ctx.cwd, access: "edit", stream: ctx.print });
    await setTaskStatus(ctx.cwd, task, "in_progress");
    const gate = await runGate(ctx, config, task, checks, approval);
    await writeRunLog(ctx.cwd, task.meta.id, `# Attempt ${attempt}\n\n${gate.report}`);
    const exhausted = !gate.passed && gate.retryable && attempt === max;
    const outcome = gate.passed ? "done" : exhausted ? "blocked" : "failed";
    await record(ctx, task, gate, startedAt, true, outcome);
    if (gate.passed) return complete(ctx, task);
    if (!gate.retryable) {
      ctx.prompter.outro(t("next.notDone", { id: task.meta.id, command: `${CLI} next` }));
      return false;
    }
    if (exhausted) break;
    await learnFromReviews(ctx, config, task, gate);
    prompt = renderPrompt(await loadPrompt("retry", ctx.cwd), {
      task: task.text,
      failure: gate.report,
      attempt: String(attempt),
    });
  }
  await setTaskStatus(ctx.cwd, task, "blocked");
  await learnFromFailure(ctx, config, task, "blocked");
  ctx.prompter.outro(t("next.blocked", { id: task.meta.id, path: `.bae/runs/${task.meta.id}/` }));
  return false;
}

async function record(
  ctx: CommandContext,
  task: Task,
  gate: Gate,
  startedAt: Date,
  headless: boolean,
  outcome: AttemptOutcome,
): Promise<void> {
  await recordAttempt(ctx.cwd, task.meta.id, {
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    headless,
    outcome,
    ...(gate.stage ? { stage: gate.stage } : {}),
    regressions: gate.regressions,
  });
}

async function learnFromReviews(
  ctx: CommandContext,
  config: Config,
  task: Task,
  gate: Gate,
): Promise<void> {
  if (gate.stage !== "review") return;
  const failures = (await readAttempts(ctx.cwd, task.meta.id)).filter(
    (attempt) => attempt.stage === "review",
  );
  if (failures.length >= REVIEW_FAILURES_FOR_LESSON) {
    await learnFromFailure(ctx, config, task, "review");
  }
}

async function complete(ctx: CommandContext, task: Task): Promise<boolean> {
  await setTaskStatus(ctx.cwd, task, "done");
  ctx.prompter.outro(t("next.done", { id: task.meta.id, command: `${CLI} next` }));
  return true;
}

async function taskPrompt(
  ctx: CommandContext,
  config: Config,
  task: Task,
  tasks: Task[],
): Promise<string> {
  const others = tasks.map((item) => (item.meta.id === task.meta.id ? task : item));
  const metrics = await readMetrics(
    ctx.cwd,
    others.filter((item) => item.meta.status === "done").map((item) => item.meta.id),
  );
  return renderPrompt(await loadPrompt("task", ctx.cwd), {
    context: planContext(config, others, task, completionTimes(metrics)),
    task: task.text.trim(),
    task_path: task.path,
    max_log_lines: String(MAX_LOG_LINES),
    suite:
      suiteCommands(config).length > 0
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
