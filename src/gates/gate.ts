import { join } from "node:path";
import type { CommandContext } from "../commands/context.js";
import type { Config } from "../config/schema.js";
import { readTextIfExists } from "../core/fs.js";
import type { ShellResult } from "../core/process.js";
import { t } from "../i18n/index.js";
import { formatFindings, reviewTask } from "../review/run.js";
import type { GateStage } from "../tasks/attempts.js";
import { logLines, MAX_LOG_LINES } from "../tasks/handoff.js";
import { parseTask, type Task } from "../tasks/schema.js";
import { findUnsafe, runVerification, type VerificationRun } from "../tasks/verify.js";
import { checkRegressions, readSuiteBaseline, runSuite, type SuiteCommand } from "./regression.js";

export type Approval = { granted: boolean };
export type Checks = { commands: string[]; suite: SuiteCommand[] };
export type Gate = {
  passed: boolean;
  retryable: boolean;
  report: string;
  stage?: GateStage;
  regressions: string[];
};

const OUTPUT_TAIL = 4_000;

export async function runGate(
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
      return failure("declined", t("verify.declined"), false);
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
    return failure("verification", verificationText);
  }
  ctx.prompter.success(t("verify.passed"));
  const regression = await regressionGate(ctx, config, task, suite, verification.runs);
  const checked = [verificationText, regression?.report].filter(Boolean).join("\n\n");
  const regressions = regression?.regressions.map((result) => result.key) ?? [];
  if (regressions.length > 0) return { ...failure("regression", checked), regressions };
  const current = await reloadTask(ctx, task);
  const handoff = handoffProblem(current);
  if (handoff) {
    ctx.prompter.warn(handoff);
    return failure("handoff", `${checked}\n\n## Handoff note\n\n${handoff}`);
  }
  ctx.prompter.success(t("handoff.passed"));
  const review = await reviewTask(ctx, config, current);
  if (review.reason) ctx.prompter.warn(review.reason);
  const findings = formatFindings(review.findings);
  if (findings) ctx.prompter.note(findings, t("review.findings"));
  const report = `${checked}\n\n## Review\n\n${review.status}\n\n${findings}`.trim();
  if (review.status === "fail") return failure("review", report);
  if (review.status === "pass") ctx.prompter.success(t("review.passed"));
  return { passed: true, retryable: false, report, regressions: [] };
}

function failure(stage: GateStage, report: string, retryable = true): Gate {
  return { passed: false, retryable, report, stage, regressions: [] };
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
    return failure("refused", t("verify.none"), false);
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
  return failure("refused", lines.join("\n"), false);
}

function verificationReport(verification: VerificationRun): string {
  const runs = verification.runs.map(
    (run) =>
      `$ ${run.command} (exit ${run.exitCode})\n\n\`\`\`text\n${run.output.slice(-OUTPUT_TAIL).trim()}\n\`\`\``,
  );
  return ["## Verification", ...runs].join("\n\n");
}

async function reloadTask(ctx: CommandContext, task: Task): Promise<Task> {
  const text = await readTextIfExists(join(ctx.cwd, ...task.path.split("/")));
  if (text === undefined) return task;
  try {
    return parseTask(task.path, text);
  } catch {
    return task;
  }
}

function handoffProblem(task: Task): string | undefined {
  const count = logLines(task).length;
  const vars = { path: task.path, max: MAX_LOG_LINES, count };
  if (count === 0) return t("handoff.missing", vars);
  return count > MAX_LOG_LINES ? t("handoff.tooLong", vars) : undefined;
}
