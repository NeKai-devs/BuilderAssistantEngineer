import { join } from "node:path";
import type { CommandContext } from "../commands/context.js";
import { UserError } from "../core/errors.js";
import { readTextIfExists } from "../core/fs.js";
import { t } from "../i18n/index.js";
import type { ReviewFinding } from "../review/parse.js";
import { capturedTask, formatFindings, type ReviewResult, reviewTask } from "../review/run.js";
import type { GateStage } from "../tasks/attempts.js";
import { logLines, MAX_LOG_LINES } from "../tasks/handoff.js";
import { parseTask, type Task } from "../tasks/schema.js";
import { findUnsafe, runVerification, type VerificationRun } from "../tasks/verify.js";
import type { Capture } from "./capture.js";
import { enforceContract } from "./enforce.js";
import type { Acceptance } from "./findings.js";
import {
  checkRegressions,
  formatCounts,
  type RegressionCheck,
  runSuite,
  type SuiteBaseline,
  type SuiteCheck,
  type SuiteCommand,
} from "./regression.js";

export type Approval = { granted: boolean };
export type Checks = { commands: string[]; suite: SuiteCommand[] };
export type GateRun = {
  capture: Capture;
  checks: Checks;
  approval: Approval;
  acceptance: Acceptance;
  allowSkip: boolean;
};
export type Gate = {
  passed: boolean;
  retryable: boolean;
  report: string;
  stage?: GateStage;
  reason?: string;
  regressions: string[];
  skips: string[];
};

const OUTPUT_TAIL = 4_000;

export async function runGate(ctx: CommandContext, run: GateRun): Promise<Gate> {
  const { capture, checks, approval, acceptance } = run;
  const skips = [...capture.skips];
  const fail = (stage: GateStage, report: string, reason?: string, retryable = true): Gate => ({
    passed: false,
    retryable,
    report,
    stage,
    ...(reason ? { reason } : {}),
    regressions: [],
    skips,
  });
  const contract = await enforceContract(ctx, capture, acceptance);
  if (contract.blocked) return fail("contract", contract.report, t("contract.failed"));
  const refused = refusal(checks);
  if (refused) {
    ctx.prompter.warn(refused);
    return fail("refused", refused, refused, false);
  }
  const baseline = suiteBaseline(capture);
  const excluded = new Set(baseline?.excluded ?? []);
  const suite = baseline?.skipped ? [] : checks.suite.filter((item) => !excluded.has(item.command));
  if (!approval.granted) {
    const all = [...checks.commands, ...suite.map((item) => item.command)];
    ctx.prompter.note(
      [...new Set(all)].map((command) => `$ ${command}`).join("\n"),
      t("verify.commands"),
    );
    if (!ctx.flags.yes && !(await ctx.prompter.confirm(t("verify.confirm"), true))) {
      return fail("declined", t("verify.declined"), t("verify.declined"), false);
    }
    approval.granted = true;
  }
  const fix = capturedTask(capture).meta.tests === "fix";
  const regression =
    suite.length > 0 ? await regressionStage(ctx, suite, baseline, fix) : undefined;
  const sections = [contract.report, regression?.report];
  if (regression && !regression.passed) {
    return {
      ...fail("regression", joinSections(sections), t("regression.failed")),
      regressions: regression.regressions.map((check) => check.command),
    };
  }
  const known = new Map((regression?.checks ?? []).map((check) => [check.command, check]));
  const excused = new Set([
    ...(fix ? [] : (regression?.preexisting ?? []).map((check) => check.command)),
    ...excluded,
  ]);
  const verification = await runVerification(ctx.cwd, checks.commands, ctx.print, known, excused);
  sections.push(verificationReport(verification, excused));
  if (!verification.passed) {
    const last = verification.runs.at(-1);
    const reason = t("verify.failed", { command: last?.command ?? "", code: last?.exitCode ?? -1 });
    ctx.prompter.warn(reason);
    return fail("verification", joinSections(sections), reason);
  }
  ctx.prompter.success(t("verify.passed"));
  const handoff = handoffProblem(await currentTask(ctx, capture));
  if (handoff) {
    ctx.prompter.warn(handoff);
    return fail("handoff", joinSections([...sections, `## Handoff note\n\n${handoff}`]), handoff);
  }
  ctx.prompter.success(t("handoff.passed"));
  const review = await safeReview(ctx, capture, stillFailing(verification), acceptance);
  if (review.reason) ctx.prompter.warn(review.reason);
  const findings = formatFindings(review.findings);
  if (findings) ctx.prompter.note(findings, t("review.findings"));
  sections.push(`## Review\n\n${review.status}\n\n${findings}`.trim(), acceptedReport(acceptance));
  if (review.status === "fail") return fail("review", joinSections(sections), review.reason);
  if (review.status !== "pass") {
    const reason = review.reason ?? t("review.noVerdict");
    if (!run.allowSkip) {
      return fail("review", joinSections([...sections, reason]), reason, review.status === "error");
    }
    skips.push(`review: ${reason}`);
    ctx.prompter.warn(t("skip.used", { what: reason }));
  }
  if (review.status === "pass") ctx.prompter.success(t("review.passed"));
  return {
    passed: true,
    retryable: false,
    report: joinSections([...sections, skippedReport(skips)]),
    regressions: [],
    skips,
  };
}

export function refusal(checks: Checks): string | undefined {
  if (checks.commands.length === 0) return t("verify.none");
  const lines = [
    ...findUnsafe(checks.commands).map((item) =>
      t("verify.unsafe", { command: item.command, reason: item.reason }),
    ),
    ...findUnsafe(checks.suite.map((item) => item.command)).map((item) =>
      t("regression.unsafe", { command: item.command, reason: item.reason }),
    ),
  ];
  return lines.length > 0 ? lines.join("\n") : undefined;
}

async function safeReview(
  ctx: CommandContext,
  capture: Capture,
  notes: ReviewFinding[],
  acceptance: Acceptance,
): Promise<ReviewResult | { status: "error"; findings: ReviewFinding[]; reason: string }> {
  try {
    return await reviewTask(ctx, capture, notes, acceptance);
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    return { status: "error", findings: [], reason: t("review.error", { details: error.message }) };
  }
}

async function regressionStage(
  ctx: CommandContext,
  suite: SuiteCommand[],
  baseline: SuiteBaseline | undefined,
  fix: boolean,
): Promise<RegressionCheck> {
  const check = checkRegressions(await runSuite(ctx.cwd, suite, ctx.print), baseline, fix);
  for (const item of check.regressions) ctx.prompter.warn(regressionMessage(item));
  for (const item of check.preexisting) {
    ctx.prompter.info(t("regression.stillFailing", { command: item.command, code: item.exitCode }));
  }
  if (check.passed) ctx.prompter.success(t("regression.passed"));
  return check;
}

function regressionMessage(check: SuiteCheck): string {
  const vars = { command: check.command, code: check.exitCode };
  if (check.verdict === "mustPass") return t("regression.mustPass", vars);
  if (check.verdict === "uncomparable") return t("regression.uncomparable", vars);
  if (check.verdict === "regression" && check.before && check.before.exitCode !== 0) {
    return t("regression.worse", {
      command: check.command,
      now: check.counts ? formatCounts(check.counts) : "",
      before: check.before.counts ? formatCounts(check.before.counts) : "",
    });
  }
  return t("regression.found", vars);
}

function suiteBaseline(capture: Capture): SuiteBaseline | undefined {
  if (capture.config.gates.regression !== "full") return undefined;
  return capture.baseline;
}

function acceptedReport(acceptance: Acceptance): string {
  if (acceptance.accepted.length === 0) return "";
  return `## ${t("findings.acceptedTitle")}\n\n${formatFindings(acceptance.accepted)}`;
}

function skippedReport(skips: string[]): string {
  if (skips.length === 0) return "";
  return `## ${t("skip.title")}\n\n${skips.map((skip) => `- ${skip}`).join("\n")}`;
}

function verificationReport(verification: VerificationRun, excused: Set<string>): string {
  const runs = verification.runs.map((run) => {
    const note =
      run.exitCode !== 0 && excused.has(run.command)
        ? ", preexisting: it already failed before the task and did not get worse"
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

function joinSections(sections: (string | undefined)[]): string {
  return sections.filter(Boolean).join("\n\n");
}
