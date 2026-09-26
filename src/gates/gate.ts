import { join } from "node:path";
import type { CommandContext } from "../commands/context.js";
import { readTextIfExists } from "../core/fs.js";
import type { ShellResult } from "../core/process.js";
import { type MessageKey, t } from "../i18n/index.js";
import type { ReviewFinding } from "../review/parse.js";
import { capturedTask, formatFindings, reviewTask } from "../review/run.js";
import { inScope, scopePaths } from "../review/scope.js";
import type { GateStage } from "../tasks/attempts.js";
import { logLines, MAX_LOG_LINES } from "../tasks/handoff.js";
import { parseTask, type Task } from "../tasks/schema.js";
import { findUnsafe, runVerification, type VerificationRun } from "../tasks/verify.js";
import type { Capture } from "./capture.js";
import {
  type ContractChange,
  type ContractKind,
  checkContract,
  isAcceptableKind,
  restoreContract,
} from "./contract.js";
import { type Acceptance, accept, findingId } from "./findings.js";
import {
  checkRegressions,
  failingBefore,
  runSuite,
  type SuiteBaseline,
  type SuiteCommand,
} from "./regression.js";

export type Approval = { granted: boolean };
export type Checks = { commands: string[]; suite: SuiteCommand[] };
export type GateRun = {
  capture: Capture;
  checks: Checks;
  approval: Approval;
  acceptance: Acceptance;
};
export type Gate = {
  passed: boolean;
  retryable: boolean;
  report: string;
  stage?: GateStage;
  regressions: string[];
};

const OUTPUT_TAIL = 4_000;
const CONTRACT_MESSAGES: Record<ContractKind, MessageKey> = {
  task: "contract.task",
  tasks: "contract.tasks",
  bae: "contract.bae",
  agents: "contract.agents",
  gitignore: "contract.gitignore",
  scripts: "contract.scripts",
  runner: "contract.runner",
};

export async function runGate(ctx: CommandContext, run: GateRun): Promise<Gate> {
  const { capture, checks, approval, acceptance } = run;
  const contract = await enforceContract(ctx, capture, acceptance);
  if (contract.blocked) return failure("contract", contract.report);
  const baseline = suiteBaseline(capture);
  const suite = baseline?.skipped ? [] : checks.suite;
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
  const preexisting = failingBefore(suite, baseline);
  const verification = await runVerification(ctx.cwd, checks.commands, ctx.print, preexisting);
  const verificationText = verificationReport(verification, preexisting);
  if (!verification.passed) {
    const last = verification.runs.at(-1);
    ctx.prompter.warn(
      t("verify.failed", { command: last?.command ?? "", code: last?.exitCode ?? -1 }),
    );
    return failure("verification", verificationText);
  }
  ctx.prompter.success(t("verify.passed"));
  const regression = await regressionGate(ctx, suite, baseline, verification.runs);
  const checked = [contract.report, verificationText, regression?.report]
    .filter(Boolean)
    .join("\n\n");
  const regressions = regression?.regressions.map((result) => result.key) ?? [];
  if (regressions.length > 0) return { ...failure("regression", checked), regressions };
  const handoff = handoffProblem(await currentTask(ctx, capture));
  if (handoff) {
    ctx.prompter.warn(handoff);
    return failure("handoff", `${checked}\n\n## Handoff note\n\n${handoff}`);
  }
  ctx.prompter.success(t("handoff.passed"));
  const review = await reviewTask(ctx, capture, stillFailing(verification), acceptance);
  if (review.reason) ctx.prompter.warn(review.reason);
  const findings = formatFindings(review.findings);
  if (findings) ctx.prompter.note(findings, t("review.findings"));
  const report = [
    checked,
    `## Review\n\n${review.status}\n\n${findings}`.trim(),
    acceptedReport(acceptance),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (review.status === "fail") return failure("review", report);
  if (review.status === "pass") ctx.prompter.success(t("review.passed"));
  return { passed: true, retryable: false, report, regressions: [] };
}

export async function enforceContract(
  ctx: CommandContext,
  capture: Capture,
  acceptance: Acceptance,
): Promise<{ blocked: boolean; report: string }> {
  const changes = await checkContract(ctx.cwd, capture.protected, capture.path);
  if (changes.length === 0) return { blocked: false, report: "" };
  const scope = scopePaths(capturedTask(capture));
  const findings = changes.map((change) =>
    settled(change, accept(acceptance, contractFinding(change), acceptable(change, scope))),
  );
  const restore = changes.filter((_, index) => findings[index]?.severity === "blocker");
  await restoreContract(ctx.cwd, restore);
  const blocked = restore.length > 0;
  const list = formatFindings(findings);
  if (blocked) ctx.prompter.warn(t("contract.failed"));
  ctx.prompter.note(list, t("contract.title"));
  return { blocked, report: `## ${t("contract.title")}\n\n${list}` };
}

function contractFinding(change: ContractChange): ReviewFinding {
  return {
    severity: "blocker",
    id: findingId("contract", change.path, change.detail),
    file: change.path,
    message: t(CONTRACT_MESSAGES[change.kind], { path: change.path, detail: change.detail }),
  };
}

function settled(change: ContractChange, finding: ReviewFinding): ReviewFinding {
  const done =
    finding.severity !== "blocker"
      ? t("findings.accepted")
      : t(change.change === "created" ? "contract.removed" : "contract.restored");
  return { ...finding, message: `${finding.message} ${done}` };
}

function acceptable(change: ContractChange, scope: string[]): boolean {
  return (
    change.change !== "created" && isAcceptableKind(change.kind) && inScope(change.path, scope)
  );
}

function acceptedReport(acceptance: Acceptance): string {
  if (acceptance.accepted.length === 0) return "";
  return `## ${t("findings.acceptedTitle")}\n\n${formatFindings(acceptance.accepted)}`;
}

function failure(stage: GateStage, report: string, retryable = true): Gate {
  return { passed: false, retryable, report, stage, regressions: [] };
}

function suiteBaseline(capture: Capture): SuiteBaseline | undefined {
  if (capture.config.gates.regression !== "full") return undefined;
  return capture.baseline;
}

async function regressionGate(
  ctx: CommandContext,
  suite: SuiteCommand[],
  baseline: SuiteBaseline | undefined,
  runs: VerificationRun["runs"],
) {
  if (suite.length === 0) return undefined;
  const known = new Map<string, ShellResult>(runs.map((run) => [run.command, run]));
  const results = await runSuite(ctx.cwd, suite, ctx.print, known);
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

function verificationReport(verification: VerificationRun, preexisting: Set<string>): string {
  const runs = verification.runs.map((run) => {
    const note =
      run.exitCode !== 0 && preexisting.has(run.command)
        ? ", preexisting: it already failed before the task"
        : "";
    const output = run.output.slice(-OUTPUT_TAIL).trim();
    return `$ ${run.command} (exit ${run.exitCode}${note})\n\n\`\`\`text\n${output}\n\`\`\``;
  });
  return ["## Verification", ...runs].join("\n\n");
}

function stillFailing(verification: VerificationRun): ReviewFinding[] {
  return verification.runs
    .filter((run) => run.exitCode !== 0)
    .map((run) => ({
      severity: "minor",
      message: t("verify.stillFailing", { command: run.command, code: run.exitCode }),
    }));
}

async function currentTask(ctx: CommandContext, capture: Capture): Promise<Task> {
  const fallback = capturedTask(capture);
  const text = await readTextIfExists(join(ctx.cwd, ...capture.path.split("/")));
  if (text === undefined) return fallback;
  try {
    return parseTask(capture.path, text);
  } catch {
    return fallback;
  }
}

function handoffProblem(task: Task): string | undefined {
  const count = logLines(task).length;
  const vars = { path: task.path, max: MAX_LOG_LINES, count };
  if (count === 0) return t("handoff.missing", vars);
  return count > MAX_LOG_LINES ? t("handoff.tooLong", vars) : undefined;
}
