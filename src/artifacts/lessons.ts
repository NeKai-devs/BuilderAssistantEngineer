import { t } from "../i18n/index.js";

export const LESSONS_BEGIN = "<!-- bae:lessons -->";
export const LESSONS_END = "<!-- bae:lessons:end -->";

export function readLessons(text: string): string[] {
  const start = text.indexOf(LESSONS_BEGIN);
  const end = text.indexOf(LESSONS_END);
  if (start === -1 || end < start) return [];
  return text
    .slice(start + LESSONS_BEGIN.length, end)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

export function withLessons(body: string, lessons: string[]): string {
  const clean = removeLessons(body).trimEnd();
  if (lessons.length === 0) return clean;
  const list = lessons.map((lesson) => `- ${lesson}`).join("\n");
  const section = `## ${t("md.lessons")}\n\n${LESSONS_BEGIN}\n${list}\n${LESSONS_END}`;
  return clean ? `${clean}\n\n${section}` : section;
}

function removeLessons(body: string): string {
  const start = body.indexOf(LESSONS_BEGIN);
  const end = body.indexOf(LESSONS_END);
  if (start === -1 || end < start) return body;
  const heading = body.lastIndexOf("\n## ", start);
  const from = heading === -1 ? start : heading;
  return `${body.slice(0, from)}${body.slice(end + LESSONS_END.length)}`;
}
