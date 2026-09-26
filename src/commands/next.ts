import type { Config } from "../config/schema.js";
import { ExitCode } from "../core/errors.js";
import { headCommit } from "../core/git.js";
import { ensureGitignore } from "../core/gitignore.js";
import type { ShellResult } from "../core/process.js";
import { loadPrompt, renderPrompt } from "../core/prompt-loader.js";
import {
  baselineFrom,
  checkRegressions,
  readSuiteBaseline,
  runSuite,
  type SuiteCommand,
  saveSuiteBaseline,
  suiteCommands,
} from "../gates/regression.js";
import { t } from "../i18n/index.js";
import { formatFindings, reviewTask } from "../review/run.js";
import { readBase, saveBase, writeRunLog } from "../tasks/runs.js";
import type { Task } from "../tasks/schema.js";
import { verificationCommands } from "../tasks/schema.js";
import { pickNext, waitingOn } from "../tasks/select.js";
import { setTaskStatus } from "../tasks/status.js";
import { findUnsafe, runVerification, type VerificationRun } from "../tasks/verify.js";
import type { CommandContext } from "./context.js";
import { CLI, isAgentBackend, loadValidTasks, requireConfig } from "./shared.js";

export type NextOptions = { headless?: boolean };

type Approval = { granted: boolean };
type Gate = { passed: boolean; retryable: boolean; report: string };
type Checks = { commands: string[]; suite: SuiteCommand[] };

export const MAX_RETRIES = 2;
const OUTPUT_TAIL = 4_000;

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
  const headless = Boolean(options.headless) && isAgentBackend(config.backend);
  if (options.headless && !headless) ctx.prompter.warn(t("next.headlessNeedsAgent"));
  const done = headless
    ? await headlessLoop(ctx, config, started, checks)
    : await attemptOnce(ctx, config, started, checks);
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
): Promise<boolean> {
  const backend = ctx.createBackend(isAgentBackend(config.backend) ? config.backend : "manual");
  ctx.prompter.info(t("next.launching", { backend: backend.name }));
  await backend.run(await taskPrompt(ctx, task), { cwd: ctx.cwd, interactive: true });
  await setTaskStatus(ctx.cwd, task, "in_progress");
  const gate = await runGate(ctx, config, task, checks, { granted: false });
  await writeRunLog(ctx.cwd, task.meta.id, gate.report);
  if (gate.passed) return complete(ctx, task);
  ctx.prompter.outro(t("next.notDone", { id: task.meta.id, command: `${CLI} next` }));
  return false;
}

async function headlessLoop(
  ctx: CommandContext,
  config: Config,
  task: Task,
  checks: Checks,
): Promise<boolean> {
  const backend = ctx.createBackend(config.backend);
  const approval: Approval = { granted: false };
  let prompt = await taskPrompt(ctx, task);
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    ctx.prompter.info(t("next.attempt", { attempt, max: MAX_RETRIES + 1, backend: backend.name }));
    await backend.run(prompt, { cwd: ctx.cwd, access: "edit", stream: ctx.print });
    await setTaskStatus(ctx.cwd, task, "in_progress");
    const gate = await runGate(ctx, config, task, checks, approval);
    await writeRunLog(ctx.cwd, task.meta.id, `# Attempt ${attempt}\n\n${gate.report}`);
    if (gate.passed) return complete(ctx, task);
    if (!gate.retryable) {
      ctx.prompter.outro(t("next.notDone", { id: task.meta.id, command: `${CLI} next` }));
      return false;
    }
    prompt = renderPrompt(await loadPrompt("retry", ctx.cwd), {
      task: task.text,
      failure: gate.report,
      attempt: String(attempt),
    });
  }
  await setTaskStatus(ctx.cwd, task, "blocked");
  ctx.prompter.outro(t("next.blocked", { id: task.meta.id, path: `.bae/runs/${task.meta.id}/` }));
  return false;
}

async function runGate(
  ctx: CommandContext,
  config: Config,
  task: Task,
  checks: Checks,
  approval: Approval,
): Promise<Gate> {
  const suite = await activeSuite(ctx, task, checks.suite);
  const refused = refuse(ctx, checks.commands, suite);
  if (refused) return refused;
  if (!approval.granted) {
    const all = [...checks.commands, ...suite.map((item) => item.command)];
    ctx.prompter.note(
      [...new Set(all)].map((command) => `$ ${command}`).join("\n"),
      t("verify.commands"),
    );
    if (!ctx.flags.yes && !(await ctx.prompter.confirm(t("verify.confirm"), true))) {
      return { passed: false, retryable: false, report: t("verify.declined") };
    }
    approval.granted = true;
  }
  const verification = await runVerification(ctx.cwd, checks.commands, ctx.print);
  const verificationText = verificationReport(verification);
  if (!verification.passed) {
    const last = verification.runs.at(-1);
    ctx.prompter.warn(
      t("verify.failed", { command: last?.command ?? "", code: last?.exitCode ?? -1 }),
    );
    return { passed: false, retryable: true, report: verificationText };
  }
  ctx.prompter.success(t("verify.passed"));
  const regression = await regressionGate(ctx, config, task, suite, verification.runs);
  const checked = [verificationText, regression?.report].filter(Boolean).join("\n\n");
  if (regression && !regression.passed) {
    return { passed: false, retryable: true, report: checked };
  }
  const review = await reviewTask(ctx, config, task);
  if (review.reason) ctx.prompter.warn(review.reason);
  const findings = formatFindings(review.findings);
  if (findings) ctx.prompter.note(findings, t("review.findings"));
  const report = `${checked}\n\n## Review\n\n${review.status}\n\n${findings}`.trim();
  if (review.status === "fail") return { passed: false, retryable: true, report };
  if (review.status === "pass") ctx.prompter.success(t("review.passed"));
  return { passed: true, retryable: false, report };
}

async function activeSuite(
  ctx: CommandContext,
  task: Task,
  suite: SuiteCommand[],
): Promise<SuiteCommand[]> {
  if (suite.length === 0) return suite;
  return (await readSuiteBaseline(ctx.cwd, task.meta.id))?.skipped ? [] : suite;
}

async function regressionGate(
  ctx: CommandContext,
  config: Config,
  task: Task,
  suite: SuiteCommand[],
  runs: VerificationRun["runs"],
) {
  if (suite.length === 0) return undefined;
  const known = new Map<string, ShellResult>(runs.map((run) => [run.command, run]));
  const results = await runSuite(ctx.cwd, suite, ctx.print, known);
  const baseline =
    config.gates.regression === "full" ? await readSuiteBaseline(ctx.cwd, task.meta.id) : undefined;
  const check = checkRegressions(results, baseline);
  for (const result of check.regressions) {
    ctx.prompter.warn(t("regression.found", { command: result.command, code: result.exitCode }));
  }
  for (const result of check.preexisting) {
    ctx.prompter.info(
      t("regression.stillFailing", { command: result.command, code: result.exitCode }),
    );
  }
  if (check.passed) ctx.prompter.success(t("regression.passed"));
  return check;
}

function refuse(ctx: CommandContext, commands: string[], suite: SuiteCommand[]): Gate | undefined {
  if (commands.length === 0) {
    ctx.prompter.warn(t("verify.none"));
    return { passed: false, retryable: false, report: t("verify.none") };
  }
  const lines = [
    ...findUnsafe(commands).map((item) =>
      t("verify.unsafe", { command: item.command, reason: item.reason }),
    ),
    ...findUnsafe(suite.map((item) => item.command)).map((item) =>
      t("regression.unsafe", { command: item.command, reason: item.reason }),
    ),
  ];
  if (lines.length === 0) return undefined;
  for (const line of lines) ctx.prompter.warn(line);
  return { passed: false, retryable: false, report: lines.join("\n") };
}

async function complete(ctx: CommandContext, task: Task): Promise<boolean> {
  await setTaskStatus(ctx.cwd, task, "done");
  ctx.prompter.outro(t("next.done", { id: task.meta.id, command: `${CLI} next` }));
  return true;
}

function verificationReport(verification: VerificationRun): string {
  const runs = verification.runs.map(
    (run) =>
      `$ ${run.command} (exit ${run.exitCode})\n\n\`\`\`text\n${run.output.slice(-OUTPUT_TAIL).trim()}\n\`\`\``,
  );
  return ["## Verification", ...runs].join("\n\n");
}

async function taskPrompt(ctx: CommandContext, task: Task): Promise<string> {
  return renderPrompt(await loadPrompt("task", ctx.cwd), { task: task.text.trim() });
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
