import { join } from "node:path";
import { LANGUAGE_NAMES } from "../analyst/prompt.js";
import { runWithFormatRetry } from "../analyst/retry.js";
import type { CommandContext } from "../commands/context.js";
import { readTextIfExists } from "../core/fs.js";
import { renderPrompt } from "../core/prompt-loader.js";
import { truncateText } from "../digest/format.js";
import { type Capture, capturedPrompt } from "../gates/capture.js";
import { withoutLog } from "../gates/contract.js";
import { type Acceptance, newAcceptance } from "../gates/findings.js";
import { t } from "../i18n/index.js";
import { logLines } from "../tasks/handoff.js";
import { parseTask, type Task } from "../tasks/schema.js";
import { type AddedText, committedText, taskChanges } from "./changes.js";
import { reviewDiff } from "./diff.js";
import { type MechanicalFacts, mechanicalReview } from "./mechanical.js";
import { parseReview, REVIEW_FORMAT, type ReviewFinding } from "./parse.js";
import { scopePaths } from "./scope.js";

export type ReviewResult = {
  status: "pass" | "fail" | "skipped";
  findings: ReviewFinding[];
  reason?: string;
  stage?: "mechanical" | "reviewer";
};

const MAX_AGENTS_MD = 20_000;
const REASONS = {
  noGit: "review.noGit",
  noBase: "review.noBase",
  gitError: "review.gitError",
} as const;

export function capturedTask(capture: Capture): Task {
  return parseTask(capture.path, capture.task);
}

export async function reviewTask(
  ctx: CommandContext,
  capture: Capture,
  notes: ReviewFinding[] = [],
  acceptance: Acceptance = newAcceptance(),
  facts: MechanicalFacts = { testsGrew: false },
  evidence = "",
): Promise<ReviewResult> {
  const task = capturedTask(capture);
  const view = await taskChanges(ctx.cwd, capture);
  if (!view.ok) {
    const reason = t(REASONS[view.reason]);
    return view.reason === "noGit"
      ? { status: "skipped", findings: [], reason }
      : { status: "fail", findings: [{ severity: "blocker", message: reason }], reason };
  }
  const log = await currentLog(ctx.cwd, capture);
  const scanned = log ? { ...view.changes, added: [...view.changes.added, log] } : view.changes;
  const history = await committedText(ctx.cwd, view.ref);
  if (!history) {
    const reason = t("review.gitError");
    return { status: "fail", findings: [{ severity: "blocker", message: reason }], reason };
  }
  const mechanical = mechanicalReview(task, scanned, acceptance, { ...facts, history });
  if (mechanical.passed && view.changes.files.length === 0) {
    return { status: "pass", findings: mechanical.findings, reason: t("review.noChanges") };
  }
  if (!mechanical.passed) {
    return {
      status: "fail",
      findings: mechanical.findings,
      reason: t("mechanical.failed"),
      stage: "mechanical",
    };
  }
  const diff = await reviewDiff(ctx.cwd, view.ref, view.changes, scopePaths(task));
  if (!diff) {
    const reason = t("review.gitError");
    return { status: "fail", findings: [{ severity: "blocker", message: reason }], reason };
  }
  const prompt = renderPrompt(capturedPrompt(capture, "review"), {
    reviewer: capture.reviewer,
    agents_md: truncateText(capture.agentsMd ?? "(none)", MAX_AGENTS_MD),
    task: withoutLog(capture.task),
    diff: diff.text,
    checks: formatFindings([...mechanical.findings, ...notes]) || "(none)",
    evidence: evidence || t("review.noEvidence"),
    output_language: LANGUAGE_NAMES[capture.config.lang],
  });
  if (ctx.flags.dryRun) {
    ctx.print(`${prompt}\n`);
    return { status: "skipped", findings: [], reason: t("review.dryRun") };
  }
  const backend = ctx.createBackend(capture.config.backend);
  const reply = await ctx.prompter.spinner(t("review.running", { id: task.meta.id }), () =>
    runWithFormatRetry({
      backend,
      prompt,
      options: {
        cwd: ctx.cwd,
        access: "read",
        timeoutMs: capture.config.agent.timeoutMinutes * 60_000,
      },
      parse: parseReview,
      format: REVIEW_FORMAT,
      fixPrompt: capturedPrompt(capture, "fix-format"),
      onRetry: () => ctx.prompter.warn(t("format.retrying")),
    }),
  );
  const blocked = reply.findings.some((finding) => finding.severity === "blocker");
  return {
    status: reply.verdict === "pass" && !blocked ? "pass" : "fail",
    findings: [...mechanical.findings, ...reply.findings],
    stage: "reviewer",
  };
}

async function currentLog(cwd: string, capture: Capture): Promise<AddedText | undefined> {
  const text = await readTextIfExists(join(cwd, ...capture.path.split("/")));
  if (text === undefined) return undefined;
  try {
    const lines = logLines(parseTask(capture.path, text));
    return lines.length > 0 ? { path: capture.path, text: lines.join("\n") } : undefined;
  } catch {
    return undefined;
  }
}

export function formatFindings(findings: ReviewFinding[]): string {
  return findings
    .map(
      (finding) =>
        `- [${finding.severity}]${finding.id ? ` (${finding.id})` : ""} ${finding.file ? `${finding.file}: ` : ""}${finding.message}`,
    )
    .join("\n");
}
