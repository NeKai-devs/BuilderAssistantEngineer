import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { LANGUAGE_NAMES } from "../analyst/prompt.js";
import { runWithFormatRetry } from "../analyst/retry.js";
import { readLessons, withLessons } from "../artifacts/lessons.js";
import { managedBody, mergeManaged } from "../artifacts/merge.js";
import type { CommandContext } from "../commands/context.js";
import { FormatError, UserError } from "../core/errors.js";
import { readTextIfExists, writeText } from "../core/fs.js";
import { renderPrompt } from "../core/prompt-loader.js";
import { displayPath } from "../core/state.js";
import { truncateText } from "../digest/format.js";
import { type Capture, capturedPrompt, trustAgentsMd } from "../gates/capture.js";
import { withoutLog } from "../gates/contract.js";
import { t } from "../i18n/index.js";
import { runDir } from "./runs.js";

export type LessonReason = "blocked" | "review";
export type Lesson = { rootCause: string; rule: string };

const lessonSchema = z.object({ root_cause: z.string().min(1), rule: z.string().min(1) });

export const LESSON_FORMAT =
  'JSON only: {"root_cause": "one or two sentences", "rule": "one imperative line"}';

const LESSON_FILE = "lesson.md";
const AGENTS_MD = "AGENTS.md";
const RECENT_RUNS = 3;
const MAX_RUN_CHARS = 6_000;
const MAX_AGENTS_MD = 20_000;

const REASONS: Record<LessonReason, string> = {
  blocked: "was blocked after every automatic retry failed",
  review: "failed its review twice",
};

export function parseLesson(text: string): Lesson {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) throw new FormatError("no JSON object found");
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new FormatError(`invalid JSON: ${error instanceof Error ? error.message : error}`);
  }
  const result = lessonSchema.safeParse(data);
  if (!result.success) throw new FormatError(z.prettifyError(result.error));
  const rule =
    result.data.rule
      .split(/\r?\n/)[0]
      ?.replace(/^[-*]\s+/, "")
      .trim() ?? "";
  if (rule === "") throw new FormatError("rule is empty");
  return { rootCause: result.data.root_cause.trim(), rule: rule.replace(/\s+/g, " ") };
}

export async function learnFromFailure(
  ctx: CommandContext,
  capture: Capture,
  reason: LessonReason,
): Promise<void> {
  const path = join(runDir(ctx.cwd, capture.id), LESSON_FILE);
  if (capture.config.backend === "manual" || (await readTextIfExists(path)) !== undefined) return;
  const lesson = await askLesson(ctx, capture, reason);
  if (!lesson) return;
  const { id } = capture;
  ctx.prompter.note(
    t("lesson.body", { cause: lesson.rootCause, rule: lesson.rule }),
    t("lesson.title", { id }),
  );
  const approved = ctx.flags.yes || (await ctx.prompter.confirm(t("lesson.confirm"), true));
  await writeText(path, renderLesson(id, reason, lesson, approved));
  if (!approved) {
    ctx.prompter.info(t("lesson.skipped", { path: displayPath(path) }));
    return;
  }
  await addLesson(ctx.cwd, lesson.rule);
  await trustAgentsMd(ctx.cwd, capture, withRule(capture.agentsMd, lesson.rule));
  ctx.prompter.success(t("lesson.added"));
}

export async function addLesson(cwd: string, rule: string): Promise<string> {
  const path = join(cwd, AGENTS_MD);
  const text = withRule(await readTextIfExists(path), rule);
  await writeText(path, text);
  return text;
}

export function withRule(before: string | undefined, rule: string): string {
  const lessons = readLessons(before ?? "");
  if (lessons.includes(rule)) return before ?? "";
  const body = withLessons(managedBody(before ?? ""), [...lessons, rule]);
  return mergeManaged(before, body, AGENTS_MD);
}

async function askLesson(
  ctx: CommandContext,
  capture: Capture,
  reason: LessonReason,
): Promise<Lesson | undefined> {
  const prompt = renderPrompt(capturedPrompt(capture, "lesson"), {
    reason: REASONS[reason],
    task: withoutLog(capture.task),
    failures: await recentRuns(ctx.cwd, capture.id),
    agents_md: truncateText(capture.agentsMd ?? "(none)", MAX_AGENTS_MD),
    output_language: LANGUAGE_NAMES[capture.config.lang],
  });
  try {
    return await ctx.prompter.spinner(t("lesson.asking", { id: capture.id }), () =>
      runWithFormatRetry({
        backend: ctx.createBackend(capture.config.backend),
        prompt,
        options: { cwd: ctx.cwd, access: "read" },
        parse: parseLesson,
        format: LESSON_FORMAT,
        fixPrompt: capturedPrompt(capture, "fix-format"),
        onRetry: () => ctx.prompter.warn(t("format.retrying")),
      }),
    );
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    ctx.prompter.warn(t("lesson.failed", { details: error.message }));
    return undefined;
  }
}

async function recentRuns(cwd: string, id: string): Promise<string> {
  const dir = runDir(cwd, id);
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((name) => name.endsWith(".md") && name !== LESSON_FILE)
    .sort()
    .slice(-RECENT_RUNS);
  const runs = await Promise.all(
    names.map(async (name) =>
      truncateText((await readTextIfExists(join(dir, name))) ?? "", MAX_RUN_CHARS),
    ),
  );
  return runs.join("\n\n---\n\n") || "(no run logs)";
}

function renderLesson(id: string, reason: LessonReason, lesson: Lesson, approved: boolean): string {
  return [
    `# Lesson from ${id}`,
    "",
    `- Reason: ${REASONS[reason]}`,
    `- Root cause: ${lesson.rootCause}`,
    `- Rule: ${lesson.rule}`,
    `- Added to AGENTS.md: ${approved ? "yes" : "no"}`,
    "",
  ].join("\n");
}
