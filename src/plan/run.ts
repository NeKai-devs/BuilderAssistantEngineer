import { buildAnalystPrompt } from "../analyst/prompt.js";
import { runWithFormatRetry } from "../analyst/retry.js";
import type { Backend } from "../backends/types.js";
import type { CommandContext } from "../commands/context.js";
import { isAgentBackend } from "../commands/shared.js";
import type { Config } from "../config/schema.js";
import { readInterview } from "../config/store.js";
import { loadPrompt, renderPrompt } from "../core/prompt-loader.js";
import { buildDigest } from "../digest/index.js";
import { t } from "../i18n/index.js";
import { findTruncation, mergeContinuation } from "./continuation.js";
import { type ParsedPlan, PLAN_FORMAT, type PlanQuestion, parsePlan } from "./parser.js";

export type PlanRequest = { priorPlan: string; knownTaskIds: string[] };

const MAX_CONTINUATIONS = 3;

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
  const backend = ctx.createBackend(config.backend);
  const requireReviewer = config.targets.some(
    (target) => target === "claude-code" || target === "opencode",
  );
  return ctx.prompter.spinner(t("plan.analyzing"), (update) =>
    runWithFormatRetry({
      backend,
      prompt,
      options: { cwd: ctx.cwd, access: "read", stream: progress(update) },
      parse: (text) => parsePlan(text, { knownTaskIds: request.knownTaskIds, requireReviewer }),
      format: PLAN_FORMAT,
      onRetry: () => ctx.prompter.warn(t("format.retrying")),
      complete: (text) => continueTruncated(ctx, backend, prompt, text, progress(update)),
    }),
  );
}

async function continueTruncated(
  ctx: CommandContext,
  backend: Backend,
  prompt: string,
  text: string,
  stream: (chunk: string) => void,
): Promise<string> {
  let current = text;
  for (let round = 0; round < MAX_CONTINUATIONS; round++) {
    const cut = findTruncation(current);
    if (!cut) return current;
    ctx.prompter.warn(t("plan.continuing", { marker: cut.marker }));
    const request = renderPrompt(await loadPrompt("continue", ctx.cwd), {
      prompt,
      partial: cut.complete,
      next_marker: cut.marker,
    });
    const more = await backend.run(request, { cwd: ctx.cwd, access: "read", stream });
    current = mergeContinuation(cut.complete, more);
  }
  return current;
}

export function formatQuestions(questions: PlanQuestion[]): string {
  return questions
    .map((question, index) => {
      const flag = question.blocking ? ` [${t("plan.blocking")}]` : "";
      const options = question.options?.length ? `\n   ${question.options.join(" / ")}` : "";
      const why = question.why ? ` — ${question.why}` : "";
      return `${index + 1}.${flag} ${question.question}${why}${options}`;
    })
    .join("\n");
}

function progress(update: (message: string) => void) {
  let received = 0;
  return (chunk: string) => {
    received += chunk.length;
    update(t("plan.progress", { chars: received.toLocaleString() }));
  };
}
