import { buildAnalystPrompt } from "../analyst/prompt.js";
import { runWithFormatRetry } from "../analyst/retry.js";
import type { Backend, RunOptions } from "../backends/types.js";
import type { CommandContext } from "../commands/context.js";
import { isAgentBackend } from "../commands/shared.js";
import type { Config } from "../config/schema.js";
import { readInterview } from "../config/store.js";
import { FormatError, UserError } from "../core/errors.js";
import { loadPrompt, renderPrompt } from "../core/prompt-loader.js";
import { truncateText } from "../digest/format.js";
import { buildDigest } from "../digest/index.js";
import { scanFiles } from "../digest/walk.js";
import { t } from "../i18n/index.js";
import { findTruncation, mergeContinuation } from "./continuation.js";
import { describeUnverified, findUnverified, type Unverified } from "./evidence.js";
import { type ParsedPlan, PLAN_FORMAT, parseFileBlocks, parsePlan, renderPlan } from "./parser.js";
import { repairPlan } from "./repair.js";
import { newPlanStats, type PlanStats, recordInfo, writePlanReport } from "./report.js";

export type PlanRequest = { priorPlan: string; knownTaskIds: string[] };

type Parse = (text: string) => ParsedPlan;
type Ending = { truncated?: boolean };

const MAX_CONTINUATIONS = 3;
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
  const stats = newPlanStats(config.backend);
  const backend = ctx.createBackend(config.backend);
  const requireReviewer = config.targets.some(
    (target) => target === "claude-code" || target === "opencode",
  );
  const parse: Parse = (text) =>
    parsePlan(text, { knownTaskIds: request.knownTaskIds, requireReviewer });
  try {
    const parsed = await requestPlan(ctx, backend, parse, prompt, stats);
    const checked = await checkEvidence(ctx, backend, parsed, parse, stats);
    await writePlanReport(ctx.cwd, stats, checked);
    return checked;
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
  return ctx.prompter.spinner(t("plan.analyzing"), (update) => {
    const ending: Ending = {};
    const options: RunOptions = {
      cwd: ctx.cwd,
      access: "read",
      stream: progress(update),
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
    });
  });
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
  const replaced = new Map(
    parseFileBlocks(repairPlan(reply, undefined).text)
      .filter((file) => sources.has(file.path))
      .map((file) => [file.path, file]),
  );
  if (replaced.size === 0) return undefined;
  const files = parsed.files.map((file) => replaced.get(file.path) ?? file);
  try {
    return { ...parse(renderPlan({ ...parsed, files })), warnings: parsed.warnings };
  } catch (error) {
    if (error instanceof FormatError) return undefined;
    throw error;
  }
}

async function repoFiles(cwd: string): Promise<string> {
  const { files } = await scanFiles(cwd);
  const list = files.map((file) => file.path).join("\n");
  return truncateText(list || "(no files)", MAX_REPO_FILES_CHARS);
}

function progress(update: (message: string) => void) {
  let received = 0;
  return (chunk: string) => {
    received += chunk.length;
    update(t("plan.progress", { chars: received.toLocaleString() }));
  };
}
