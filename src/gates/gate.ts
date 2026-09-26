import { join } from "node:path";
import type { CommandContext } from "../commands/context.js";
import { bashPath } from "../core/bash.js";
import { UserError } from "../core/errors.js";
import { readTextIfExists } from "../core/fs.js";
import { t } from "../i18n/index.js";
import { countIntegrity, testsGrew } from "../review/integrity.js";
import type { MechanicalFacts } from "../review/mechanical.js";
import type { ReviewFinding } from "../review/parse.js";
import { capturedTask, formatFindings, type ReviewResult, reviewTask } from "../review/run.js";
import type { GateStage } from "../tasks/attempts.js";
import { allowlistProblems, type CheckProblem, trivialityProblems } from "../tasks/checks.js";
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
import { guardState } from "./state-guard.js";

export type Approval = { granted: boolean };
export type Checks = { commands: string[]; script: string[]; suite: SuiteCommand[] };
export type Policy = { unattended: boolean; allow: string[]; bash?: string };
export type GateRun = {
  capture: Capture;
  checks: Checks;
  approval: Approval;
  acceptance: Acceptance;
  allowSkip: boolean;
  unattended: boolean;
  tampered: string[];
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
  const tampered = run.tampered.splice(0);
  if (tampered.length > 0) {
    const reason = t("state.tampered", { files: tampered.join(", ") });
    ctx.prompter.warn(reason);
    return fail("contract", `## ${t("contract.title")}\n\n${reason}`, reason);
  }
  const contract = await enforceContract(ctx, capture, acceptance);
  if (contract.blocked) return fail("contract", contract.report, t("contract.failed"));
  const recheck = async (): Promise<string | undefined> => {
    const changed = await guard.verify();
    const again = await enforceContract(ctx, capture, acceptance);
    if (changed.length === 0 && !again.blocked) return undefined;
    const state = changed.length > 0 ? t("state.tampered", { files: changed.join(", ") }) : "";
    if (state) ctx.prompter.warn(state);
    return joinSections([state, again.report]);
  };
  const bash = await bashPath();
  const refused = refusal(checks, {
    unattended: run.unattended,
    allow: capture.config.verify.allow,
    ...(bash ? { bash } : {}),
  });
  if (refused || !bash) {
    const reason = refused ?? t("verify.noBash");
    ctx.prompter.warn(reason);
    return fail("refused", reason, reason, false);
  }
  const baseline = suiteBaseline(capture);
  const excluded = new Set(baseline?.excluded ?? []);
  const suite = baseline?.skipped ? [] : checks.suite.filter((item) => !excluded.has(item.command));
  if (!approval.granted) {
    const all = [...new Set([...checks.commands, ...suite.map((item) => item.command)])];
    ctx.prompter.note(all.map((command) => `$ ${command}`).join("\n"), t("verify.commands"));
    for (const item of findUnsafe(all)) ctx.prompter.warn(t("verify.unsafeWarning", item));
    if (!ctx.flags.yes && !(await ctx.prompter.confirm(t("verify.confirm"), true))) {
      ctx.prompter.warn(t("verify.declined"));
      return fail("declined", t("verify.declined"), t("verify.declined"), false);
    }
    approval.granted = true;
  }
  const fix = capturedTask(capture).meta.tests === "fix";
  let guard = await guardState(ctx.cwd);
  const regression =
    suite.length > 0 ? await regressionStage(ctx, suite, baseline, fix) : undefined;
  const sections = [contract.report, regression?.report];
  const afterSuite = await recheck();
  if (afterSuite)
    return fail("contract", joinSections([...sections, afterSuite]), t("contract.failed"));
  if (regression && !regression.passed) {
    return {
      ...fail("regression", joinSections(sections), t("regression.failed")),
      regressions: regression.regressions.map((check) => check.command),
    };
  }
  const checksRun = regression?.checks ?? [];
  const integrity = countIntegrity(checksRun, acceptance);
  if (integrity.length > 0) {
    const list = formatFindings(integrity);
    ctx.prompter.note(list, t("integrity.title"));
    sections.push(`## ${t("integrity.title")}\n\n${list}`);
  }
  if (integrity.some((finding) => finding.severity === "blocker")) {
    return fail("integrity", joinSections(sections), t("integrity.failed"));
  }
  const known = new Map(checksRun.map((check) => [check.command, check]));
  const excused = new Set([
    ...(fix ? [] : (regression?.preexisting ?? []).map((check) => check.command)),
    ...excluded,
  ]);
  guard = await guardState(ctx.cwd);
  const verification = await runVerification(ctx.cwd, checks.script, {
    bash,
    onOutput: ctx.print,
    known,
    excused,
  });
  sections.push(verificationReport(verification));
  const afterVerification = await recheck();
  if (afterVerification) {
    return fail("contract", joinSections([...sections, afterVerification]), t("contract.failed"));
  }
  if (!verification.passed) {
    const reason = t("verify.failed", {
      command: verification.failed ?? "Verification",
      code: verification.exitCode,
    });
    ctx.prompter.warn(reason);
    return fail("verification", joinSections(sections), reason);
  }
  ctx.prompter.success(t("verify.passed"));
  const handoff = handoffProblem(await currentTask(ctx, capture));
  if (handoff) {
    ctx.prompter.warn(handoff);
    sections.push(`## Handoff note\n\n${handoff}`);
  } else {
    ctx.prompter.success(t("handoff.passed"));
  }
  const review = await safeReview(ctx, capture, stillFailing(verification, known), acceptance, {
    testsGrew: testsGrew(checksRun),
    secrets: capture.config.secrets,
  });
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

export function refusal(checks: Checks, policy: Policy): string | undefined {
  if (checks.commands.length === 0) return t("verify.none");
  if (!policy.bash) return t("verify.noBash");
  const suite = checks.suite.map((item) => item.command);
  const lines = [
    ...trivialityProblems(checks.script).map((problem) => problemText(problem, "verify")),
    ...(policy.unattended
      ? [
          ...allowlistProblems(checks.script, policy.allow).map((problem) =>
            problemText(problem, "verify"),
          ),
          ...allowlistProblems(suite, policy.allow).map((problem) =>
            problemText(problem, "regression"),
          ),
        ]
      : []),
  ];
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function problemText(problem: CheckProblem, source: "verify" | "regression"): string {
  const vars = { command: problem.command };
  if (problem.reason === "masks") return t("verify.masks", vars);
  if (problem.reason === "trivial") return t("verify.trivial", vars);
  const why = t(problem.reason === "dynamic" ? "verify.dynamic" : "verify.unknown");
  return t(source === "verify" ? "verify.notAllowed" : "regression.notAllowed", {
    ...vars,
    why,
  });
}

async function safeReview(
  ctx: CommandContext,
  capture: Capture,
  notes: ReviewFinding[],
  acceptance: Acceptance,
  facts: MechanicalFacts,
): Promise<ReviewResult | { status: "error"; findings: ReviewFinding[]; reason: string }> {
  try {
    return await reviewTask(ctx, capture, notes, acceptance, facts);
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

function verificationReport(verification: VerificationRun): string {
  const output = verification.output.slice(-OUTPUT_TAIL).trim();
  return [
    "## Verification",
    `\`\`\`sh\n${verification.script}\n\`\`\``,
    `exit ${verification.exitCode}`,
    `\`\`\`text\n${output}\n\`\`\``,
  ].join("\n\n");
}

function stillFailing(
  verification: VerificationRun,
  known: Map<string, SuiteCheck>,
): ReviewFinding[] {
  return verification.tolerated.map((command) => ({
    severity: "minor",
    message: t("verify.stillFailing", { command, code: known.get(command)?.exitCode ?? 1 }),
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
