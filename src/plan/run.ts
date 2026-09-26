import { buildAnalystPrompt } from "../analyst/prompt.js";
import { runWithFormatRetry } from "../analyst/retry.js";
import type { CommandContext } from "../commands/context.js";
import { isAgentBackend } from "../commands/shared.js";
import type { Config } from "../config/schema.js";
import { readInterview } from "../config/store.js";
import { buildDigest } from "../digest/index.js";
import { t } from "../i18n/index.js";
import { type ParsedPlan, PLAN_FORMAT, type PlanQuestion, parsePlan } from "./parser.js";

export type PlanRequest = { priorPlan: string; knownTaskIds: string[] };

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
    }),
  );
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
