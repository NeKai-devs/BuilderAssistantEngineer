import type { CommandContext } from "../commands/context.js";
import { readInterview, writeInterview } from "../config/store.js";
import { t } from "../i18n/index.js";
import { askQuestion } from "../interview/adaptive.js";
import type { PlanQuestion } from "./parser.js";

export type ClosedQuestion = PlanQuestion & { answer: string };

export async function closeQuestions(
  ctx: CommandContext,
  questions: PlanQuestion[],
): Promise<ClosedQuestion[]> {
  if (questions.length === 0) return [];
  const ask = !ctx.flags.yes && !ctx.flags.dryRun;
  const listed = ask ? questions.filter((question) => !question.blocking) : questions;
  if (listed.length > 0) ctx.prompter.note(formatQuestions(listed), t("plan.openQuestions"));
  const closed: ClosedQuestion[] = [];
  for (const question of questions) {
    const answer = ask && question.blocking ? await askQuestion(ctx.prompter, question) : "";
    closed.push({ ...question, answer: answer.trim() });
  }
  await appendQuestions(ctx.cwd, closed);
  ctx.prompter.info(t("plan.questionsSaved", { count: closed.length }));
  return closed;
}

export function renderQuestions(questions: ClosedQuestion[], date: string): string {
  const sections = questions.map((item) => {
    const lines = [`### ${item.question}`, ""];
    if (item.why) lines.push(`- ${t("md.why")}: ${item.why}`);
    if (item.options?.length) lines.push(`- ${t("md.options")}: ${item.options.join(" / ")}`);
    if (item.blocking) lines.push(`- ${t("md.blocking")}`);
    lines.push(`- ${t("md.answer")}: ${item.answer || `_${t("md.open")}_`}`);
    return lines.join("\n");
  });
  return [`## ${t("md.planQuestions", { date })}`, ...sections].join("\n\n");
}

async function appendQuestions(cwd: string, questions: ClosedQuestion[]): Promise<void> {
  const current = (await readInterview(cwd))?.trimEnd() ?? `# ${t("md.interview")}`;
  const date = new Date().toISOString().slice(0, 10);
  await writeInterview(cwd, `${current}\n\n${renderQuestions(questions, date)}\n`);
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
