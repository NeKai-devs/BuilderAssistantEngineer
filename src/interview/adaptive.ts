import { buildAnalystPrompt } from "../analyst/prompt.js";
import { runWithFormatRetry } from "../analyst/retry.js";
import type { Backend } from "../backends/types.js";
import type { Mode, Target } from "../config/schema.js";
import { UserError } from "../core/errors.js";
import { type Lang, t } from "../i18n/index.js";
import type { Prompter } from "../ui/prompter.js";
import { MAX_FOLLOW_UPS } from "./questions.js";
import { type Answer, type InterviewData, renderInterview } from "./render.js";
import { INTERVIEW_FORMAT, type InterviewReply, parseInterviewReply } from "./reply.js";

export type AdaptiveContext = {
  cwd: string;
  backend: Backend;
  prompter: Prompter;
  projectType: Mode;
  lang: Lang;
  targets: Target[];
  digest: string;
  canExplore: boolean;
};

export async function runAdaptiveRound(
  context: AdaptiveContext,
  data: InterviewData,
): Promise<InterviewData> {
  const followUps: Answer[] = [];
  context.prompter.info(t("interview.followUps", { max: MAX_FOLLOW_UPS }));
  try {
    for (let round = 0; round < MAX_FOLLOW_UPS; round++) {
      const reply = await nextReply(context, { ...data, followUps });
      if (reply.done) return { ...data, followUps, summary: reply.summary };
      followUps.push({
        question: reply.question,
        answer: await askQuestion(context.prompter, reply),
      });
    }
  } catch (error) {
    if (!(error instanceof UserError) || error.message === t("ui.cancelled")) throw error;
    context.prompter.warn(t("interview.adaptiveFailed", { details: error.message }));
  }
  return { ...data, followUps };
}

export function interviewPrompt(
  context: Omit<AdaptiveContext, "backend" | "prompter">,
  data: InterviewData,
) {
  return buildAnalystPrompt(context.cwd, {
    mode: "INTERVIEW",
    projectType: context.projectType,
    lang: context.lang,
    targets: context.targets,
    interview: renderInterview(data),
    digest: context.digest,
    canExplore: context.canExplore,
    priorPlan: "",
  });
}

async function nextReply(context: AdaptiveContext, data: InterviewData): Promise<InterviewReply> {
  const prompt = await interviewPrompt(context, data);
  return context.prompter.spinner(t("interview.thinking"), () =>
    runWithFormatRetry({
      backend: context.backend,
      prompt,
      options: { cwd: context.cwd, access: "read" },
      parse: parseInterviewReply,
      format: INTERVIEW_FORMAT,
      onRetry: () => context.prompter.warn(t("format.retrying")),
    }),
  );
}

export type Question = { question: string; why?: string; options?: string[] };

export async function askQuestion(prompter: Prompter, reply: Question): Promise<string> {
  if (reply.why) prompter.note(reply.why, reply.question);
  const options = reply.options ?? [];
  if (options.length === 0) return prompter.text(reply.question, t("interview.answer"));
  const choices = [
    ...options.map((option, index) => ({ value: `option-${index}`, label: option })),
    { value: "other", label: t("interview.other") },
    { value: "skip", label: t("interview.skip") },
  ];
  const picked = await prompter.select(reply.question, choices);
  if (picked === "skip") return "";
  if (picked === "other") return prompter.text(reply.question, t("interview.answer"));
  return options[Number(picked.slice("option-".length))] ?? "";
}
