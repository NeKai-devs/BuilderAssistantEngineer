import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { LANGUAGE_NAMES } from "../analyst/prompt.js";
import { runWithFormatRetry } from "../analyst/retry.js";
import type { CommandContext } from "../commands/context.js";
import type { Config } from "../config/schema.js";
import { readTextIfExists } from "../core/fs.js";
import { BAE_DIR } from "../core/paths.js";
import { loadPrompt, renderPrompt } from "../core/prompt-loader.js";
import { truncateText } from "../digest/format.js";
import { t } from "../i18n/index.js";
import { readBase } from "../tasks/runs.js";
import type { Task } from "../tasks/schema.js";
import { taskChanges } from "./changes.js";
import { taskDiff } from "./diff.js";
import { mechanicalReview } from "./mechanical.js";
import { parseReview, REVIEW_FORMAT, type ReviewFinding } from "./parse.js";

export type ReviewResult = {
  status: "pass" | "fail" | "skipped";
  findings: ReviewFinding[];
  reason?: string;
  stage?: "mechanical" | "reviewer";
};

const AGENT_DIRS = [".claude/agents", ".opencode/agent"];
const MAX_AGENTS_MD = 20_000;
const DEFAULT_REVIEWER =
  "A strict senior code reviewer. Checks that the changes meet every acceptance criterion, follow the project conventions, include tests, stay within the task scope and introduce no security issues.";

export async function reviewTask(
  ctx: CommandContext,
  config: Config,
  task: Task,
): Promise<ReviewResult> {
  const base = await readBase(ctx.cwd, task.meta.id);
  const exclude = [BAE_DIR, task.path];
  const diff = await taskDiff(ctx.cwd, base, exclude);
  if (diff === undefined) return { status: "skipped", findings: [], reason: t("review.noGit") };
  if (diff.trim() === "") {
    return { status: "fail", findings: [{ severity: "blocker", message: t("review.emptyDiff") }] };
  }
  const changes = await taskChanges(ctx.cwd, base, exclude);
  const mechanical = changes ? mechanicalReview(task, changes) : { passed: true, findings: [] };
  if (!mechanical.passed) {
    return {
      status: "fail",
      findings: mechanical.findings,
      reason: t("mechanical.failed"),
      stage: "mechanical",
    };
  }
  const prompt = renderPrompt(await loadPrompt("review", ctx.cwd), {
    reviewer: await findReviewer(ctx.cwd, config.backend),
    agents_md: truncateText(
      (await readTextIfExists(join(ctx.cwd, "AGENTS.md"))) ?? "(none)",
      MAX_AGENTS_MD,
    ),
    task: task.text,
    diff,
    checks: formatFindings(mechanical.findings) || "(none)",
    output_language: LANGUAGE_NAMES[config.lang],
  });
  if (ctx.flags.dryRun) {
    ctx.print(`${prompt}\n`);
    return { status: "skipped", findings: [], reason: t("review.dryRun") };
  }
  const backend = ctx.createBackend(config.backend);
  const reply = await ctx.prompter.spinner(t("review.running", { id: task.meta.id }), () =>
    runWithFormatRetry({
      backend,
      prompt,
      options: { cwd: ctx.cwd, access: "read" },
      parse: parseReview,
      format: REVIEW_FORMAT,
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

export async function findReviewer(cwd: string, backend: Config["backend"]): Promise<string> {
  const dirs = backend === "opencode" ? [...AGENT_DIRS].reverse() : AGENT_DIRS;
  for (const dir of dirs) {
    const path = join(cwd, ...dir.split("/"));
    const name = (await listNames(path)).find(
      (entry) => /review/i.test(entry) && entry.endsWith(".md"),
    );
    if (name) return (await readTextIfExists(join(path, name))) ?? DEFAULT_REVIEWER;
  }
  return DEFAULT_REVIEWER;
}

export function formatFindings(findings: ReviewFinding[]): string {
  return findings
    .map(
      (finding) =>
        `- [${finding.severity}] ${finding.file ? `${finding.file}: ` : ""}${finding.message}`,
    )
    .join("\n");
}

async function listNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}
