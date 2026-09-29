import { join, relative } from "node:path";
import { buildAnalystPrompt } from "../analyst/prompt.js";
import { runWithFormatRetry } from "../analyst/retry.js";
import { noteOpencodeModel } from "../backends/opencode-model.js";
import type { Backend, RunOptions } from "../backends/types.js";
import type { CommandContext } from "../commands/context.js";
import { isAgentBackend } from "../commands/shared.js";
import type { Config } from "../config/schema.js";
import { readInterview } from "../config/store.js";
import { FormatError, UserError } from "../core/errors.js";
import { writeText } from "../core/fs.js";
import { baePaths } from "../core/paths.js";
import { loadPrompt, renderPrompt } from "../core/prompt-loader.js";
import { truncateText } from "../digest/format.js";
import { buildDigest } from "../digest/index.js";
import { scanFiles } from "../digest/walk.js";
import { t } from "../i18n/index.js";
import { setFrontmatterFields } from "../tasks/frontmatter.js";
import { findTruncation, mergeContinuation } from "./continuation.js";
import { describeUnverified, findUnverified, type Unverified } from "./evidence.js";
import {
  type ParsedPlan,
  PLAN_FORMAT,
  parseConfigBlock,
  parseFileBlocks,
  parsePlan,
  renderPlan,
} from "./parser.js";
import { planProgress } from "./progress.js";
import { repairPlan } from "./repair.js";
import {
  newPlanStats,
  PLAN_REPORT,
  type PlanStats,
  recordInfo,
  writePlanReport,
} from "./report.js";

export type PlanRequest = { priorPlan: string; knownTaskIds: string[] };

type Parse = (text: string) => ParsedPlan;
type Ending = { truncated?: boolean };

const MAX_CONTINUATIONS = 3;
const REJECTED_PLAN = "rejected-plan.md";
const NON_PLAN = "non-plan-answer.md";
const FILE_MARKER = /<<<\s*FILE\s*:/i;
const MAX_REPO_FILES_CHARS = 20_000;

export async function generatePlan(
  ctx: CommandContext,
  config: Config,
  request: PlanRequest,
): Promise<ParsedPlan | undefined> {
  const interview = (await readInterview(ctx.cwd)) ?? "";
  if (!interview.trim()) ctx.prompter.warn(t("plan.noInterview"));
  const digest = await ctx.prompter.spinner(t("digest.reading"), async () => {
    return (await buildDigest(ctx.cwd, { maxChars: config.digest.maxChars })).text;
  });
  const prompt = await buildAnalystPrompt(ctx.cwd, {
    mode: "PLAN",
    projectType: config.mode,
    lang: config.lang,
    targets: config.targets,
    interview,
    digest,
    canExplore: isAgentBackend(config.backend),
    priorPlan: request.priorPlan,
  });
  if (ctx.flags.dryRun) {
    ctx.print(`${prompt}\n`);
    return undefined;
  }
  if (config.backend === "opencode") await noteOpencodeModel(ctx);
  const stats = newPlanStats(config.backend);
  const backend = ctx.createBackend(config.backend);
  const requireReviewer = config.targets.some(
    (target) => target === "claude-code" || target === "opencode",
  );
  const allow = config.verify.allow;
  const parse: Parse = (text) =>
    parsePlan(text, { knownTaskIds: request.knownTaskIds, requireReviewer, allow });
  try {
    const parsed = await requestPlan(ctx, backend, parse, prompt, stats);
    const checked = await checkEvidence(ctx, backend, parsed, parse, stats, config.mode);
    const reviewed = await reviewVerification(ctx, backend, checked, parse, stats);
    await writePlanReport(ctx.cwd, stats, reviewed);
    return reviewed;
  } catch (error) {
    await writePlanReport(ctx.cwd, stats, undefined, error);
    throw error;
  }
}

async function requestPlan(
  ctx: CommandContext,
  backend: Backend,
  parse: Parse,
  prompt: string,
  stats: PlanStats,
): Promise<ParsedPlan> {
  return ctx.prompter.spinner(t("plan.analyzing", { backend: backend.name }), (update) => {
    const ending: Ending = {};
    const tracker = planProgress(backend.name, update);
    const options: RunOptions = {
      cwd: ctx.cwd,
      access: "read",
      stream: tracker.stream,
      onProgress: tracker.onProgress,
      onInfo: (info) => {
        recordInfo(stats, info);
        if (info.truncated !== undefined) ending.truncated = info.truncated;
      },
    };
    const repair = (text: string) => repairAnswer(ctx, text, ending, stats);
    return runWithFormatRetry({
      backend,
      prompt,
      options,
      parse,
      format: PLAN_FORMAT,
      onRetry: (error) => {
        stats.formatRetries++;
        stats.formatErrors.push(error.message);
        ctx.prompter.warn(t("format.retrying"));
      },
      complete: (text) => continueTruncated(ctx, backend, { prompt, text, options, stats, repair }),
      retryPrompt: (first) => askForPlan(ctx, first, prompt, stats),
    });
  });
}

async function askForPlan(
  ctx: CommandContext,
  answer: string,
  prompt: string,
  stats: PlanStats,
): Promise<string | undefined> {
  if (FILE_MARKER.test(answer)) return undefined;
  stats.nonPlanAnswers++;
  const path = join(baePaths(ctx.cwd).tmp, NON_PLAN);
  await writeText(path, answer);
  const chars = answer.trim().length;
  ctx.prompter.warn(t("plan.notAPlan", { chars, path: shown(ctx.cwd, path) }));
  return `${prompt}\n\n---\n\nNote: your previous answer (${chars} characters) contained no <<<FILE: …>>> blocks, so it was not a plan. Answer again with the complete plan, in the output format described above.`;
}

async function reviewVerification(
  ctx: CommandContext,
  backend: Backend,
  plan: ParsedPlan,
  parse: Parse,
  stats: PlanStats,
): Promise<ParsedPlan> {
  if (plan.reviews.length === 0 && plan.configNotes.length === 0) return plan;
  stats.verificationRetries++;
  if (plan.reviews.length > 0) {
    ctx.prompter.warn(
      t("verification.retrying", {
        count: plan.reviews.length,
        kinds: describeReviews(plan.reviews),
        report: shown(ctx.cwd, join(baePaths(ctx.cwd).tmp, PLAN_REPORT)),
      }),
    );
  }
  if (plan.configNotes.length > 0) {
    ctx.prompter.warn(t("verification.commandsRetrying", { notes: plan.configNotes.join("\n") }));
  }
  const fixed = await ctx.prompter.spinner(t("verification.fixing"), () =>
    fixVerification(ctx, backend, plan, parse, stats),
  );
  const current = fixed ?? plan;
  const kept =
    current.configNotes.length > 0
      ? [t("verification.commandsKept", { notes: current.configNotes.join("\n") })]
      : [];
  const checked = { ...current, warnings: [...current.warnings, ...kept] };
  if (checked.reviews.length === 0) {
    if (kept.length === 0) ctx.prompter.success(t("verification.fixed"));
    return checked;
  }
  return markForReview(ctx, checked, parse, stats);
}

async function fixVerification(
  ctx: CommandContext,
  backend: Backend,
  plan: ParsedPlan,
  parse: Parse,
  stats: PlanStats,
): Promise<ParsedPlan | undefined> {
  const paths = new Set(plan.reviews.map((review) => review.path));
  const config =
    plan.configNotes.length > 0
      ? [`<<<CONFIG>>>\n${JSON.stringify({ commands: plan.commands })}\n<<<END CONFIG>>>`]
      : [];
  const prompt = renderPrompt(await loadPrompt("fix-verification", ctx.cwd), {
    problems: [
      ...plan.reviews.flatMap((review) => review.notes.map((note) => `- ${review.path}: ${note}`)),
      ...plan.configNotes.map((note) => `- CONFIG: ${note}`),
    ].join("\n"),
    files: [
      ...config,
      ...plan.files
        .filter((file) => paths.has(file.path))
        .map((file) => `<<<FILE: ${file.path}>>>\n${file.content.trimEnd()}\n<<<END FILE>>>`),
    ].join("\n\n"),
  });
  let reply: string;
  try {
    reply = await backend.run(prompt, {
      cwd: ctx.cwd,
      access: "read",
      onInfo: (info) => recordInfo(stats, info),
    });
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    ctx.prompter.warn(t("verification.retryFailed", { details: error.message }));
    return undefined;
  }
  return mergeFiles(plan, reply, paths, parse);
}

function markForReview(
  ctx: CommandContext,
  plan: ParsedPlan,
  parse: Parse,
  stats: PlanStats,
): ParsedPlan {
  const notes = new Map(plan.reviews.map((review) => [review.path, review.notes.join(" ")]));
  const files = plan.files.map((file) => {
    const note = notes.get(file.path);
    if (note === undefined) return file;
    const fields = { status: "needs_review", review_note: JSON.stringify(note) };
    return { ...file, content: setFrontmatterFields(file.content, fields) };
  });
  const ids = plan.reviews.map((review) => review.id);
  stats.needsReview = ids;
  ctx.prompter.warn(t("plan.needsReviewWarn", { count: ids.length, ids: ids.join(", ") }));
  const marked = { ...parse(renderPlan({ ...plan, files })), warnings: plan.warnings };
  const line = t("plan.needsReview", { count: ids.length, ids: ids.join(", ") });
  return { ...marked, summary: `${marked.summary}\n\n${line}` };
}

function describeReviews(reviews: ParsedPlan["reviews"]): string {
  const byKind = new Map<string, string[]>();
  for (const review of reviews) {
    for (const note of review.notes) {
      const kind = note.split(": ")[0] ?? note;
      const ids = byKind.get(kind) ?? [];
      if (!ids.includes(review.id)) byKind.set(kind, [...ids, review.id]);
    }
  }
  return [...byKind].map(([kind, ids]) => `${kind} (${ids.join(", ")})`).join("; ");
}

function mergeFiles(
  plan: ParsedPlan,
  reply: string,
  paths: Set<string>,
  parse: Parse,
): ParsedPlan | undefined {
  const text = repairPlan(reply, undefined).text;
  const replaced = new Map(
    parseFileBlocks(text)
      .filter((file) => paths.has(file.path))
      .map((file) => [file.path, file]),
  );
  const commands = parseConfigBlock(text);
  if (replaced.size === 0 && !commands) return undefined;
  const files = plan.files.map((file) => replaced.get(file.path) ?? file);
  try {
    const merged = { ...plan, files, commands: commands ?? plan.commands };
    return { ...parse(renderPlan(merged)), warnings: plan.warnings };
  } catch (error) {
    if (error instanceof FormatError) return undefined;
    throw error;
  }
}

function shown(cwd: string, path: string): string {
  return relative(cwd, path).split("\\").join("/");
}

function repairAnswer(ctx: CommandContext, text: string, ending: Ending, stats: PlanStats) {
  const repaired = repairPlan(text, ending.truncated);
  if (repaired.repairs.length > 0) {
    stats.repairs.push(...repaired.repairs);
    ctx.prompter.info(t("format.repaired", { repairs: repaired.repairs.join("; ") }));
  }
  return repaired.text;
}

async function continueTruncated(
  ctx: CommandContext,
  backend: Backend,
  answer: {
    prompt: string;
    text: string;
    options: RunOptions;
    stats: PlanStats;
    repair: (text: string) => string;
  },
): Promise<string> {
  const { prompt, options, stats, repair } = answer;
  let current = repair(answer.text);
  for (let round = 0; round < MAX_CONTINUATIONS; round++) {
    const cut = findTruncation(current);
    if (!cut) return current;
    stats.continuations++;
    ctx.prompter.warn(t("plan.continuing", { marker: cut.marker }));
    const request = renderPrompt(await loadPrompt("continue", ctx.cwd), {
      prompt,
      partial: cut.complete,
      next_marker: cut.marker,
    });
    const more = await backend.run(request, options);
    current = repair(mergeContinuation(cut.complete, more));
  }
  return current;
}

async function checkEvidence(
  ctx: CommandContext,
  backend: Backend,
  parsed: ParsedPlan,
  parse: Parse,
  stats: PlanStats,
  mode: Config["mode"],
): Promise<ParsedPlan> {
  const missing = await findUnverified(ctx.cwd, parsed);
  if (missing.length === 0) return parsed;
  stats.evidenceRetries++;
  ctx.prompter.warn(t("evidence.retrying", { count: missing.length }));
  const fixed = await ctx.prompter.spinner(t("evidence.fixing"), () =>
    fixPaths(ctx, backend, parsed, missing, parse, stats),
  );
  const plan = fixed ?? parsed;
  const remaining = fixed ? await findUnverified(ctx.cwd, fixed) : missing;
  stats.unverifiedPaths = remaining.map(describeUnverified);
  if (remaining.length === 0) {
    ctx.prompter.success(t("evidence.fixed"));
    return plan;
  }
  const lines = remaining.filter((item) => item.line !== undefined);
  if (mode === "brownfield" && lines.length > 0) {
    const path = join(baePaths(ctx.cwd).tmp, REJECTED_PLAN);
    await writeText(path, renderPlan(plan));
    throw new UserError(
      t("evidence.linesFailed", {
        list: lines.map((item) => `- ${describeUnverified(item)}`).join("\n"),
        path: relative(ctx.cwd, path).split("\\").join("/"),
      }),
    );
  }
  ctx.prompter.warn(t("evidence.unverified", { count: remaining.length }));
  const list = stats.unverifiedPaths.map((line) => `- ${line}`).join("\n");
  return { ...plan, summary: `${plan.summary}\n\n${t("evidence.summary")}\n${list}` };
}

async function fixPaths(
  ctx: CommandContext,
  backend: Backend,
  parsed: ParsedPlan,
  missing: Unverified[],
  parse: Parse,
  stats: PlanStats,
): Promise<ParsedPlan | undefined> {
  const sources = new Set(missing.map((item) => item.source));
  const affected = parsed.files.filter((file) => sources.has(file.path));
  const prompt = renderPrompt(await loadPrompt("fix-paths", ctx.cwd), {
    paths: missing.map((item) => `- ${describeUnverified(item)}`).join("\n"),
    files: affected
      .map((file) => `<<<FILE: ${file.path}>>>\n${file.content.trimEnd()}\n<<<END FILE>>>`)
      .join("\n\n"),
    repo_files: await repoFiles(ctx.cwd),
  });
  let reply: string;
  try {
    reply = await backend.run(prompt, {
      cwd: ctx.cwd,
      access: "read",
      onInfo: (info) => recordInfo(stats, info),
    });
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    ctx.prompter.warn(t("evidence.retryFailed", { details: error.message }));
    return undefined;
  }
  return mergeFiles(parsed, reply, sources, parse);
}

async function repoFiles(cwd: string): Promise<string> {
  const { files } = await scanFiles(cwd);
  const list = files.map((file) => file.path).join("\n");
  return truncateText(list || "(no files)", MAX_REPO_FILES_CHARS);
}
