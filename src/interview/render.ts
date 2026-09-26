import type { Mode } from "../config/schema.js";
import { t } from "../i18n/index.js";

export type Answer = { question: string; answer: string };

export type InterviewData = {
  mode: Mode;
  objective?: string;
  brief: string;
  answers: Answer[];
  followUps: Answer[];
  summary?: string;
};

export function renderInterview(data: InterviewData): string {
  const header = [`# ${t("md.interview")}`, "", `- ${t("md.mode")}: ${data.mode}`];
  if (data.objective) header.push(`- ${t("md.objective")}: ${data.objective}`);
  const sections = [header.join("\n")];
  if (data.brief) sections.push(`## ${t("md.brief")}\n\n${data.brief}`);
  sections.push(...data.answers.map(renderAnswer("##")));
  if (data.followUps.length > 0) {
    sections.push(`## ${t("md.followUps")}`, ...data.followUps.map(renderAnswer("###")));
  }
  if (data.summary) sections.push(`## ${t("md.summary")}\n\n${data.summary}`);
  return `${sections.join("\n\n")}\n`;
}

function renderAnswer(level: string) {
  return ({ question, answer }: Answer) =>
    `${level} ${question}\n\n${answer.trim() || `_${t("md.skipped")}_`}`;
}
