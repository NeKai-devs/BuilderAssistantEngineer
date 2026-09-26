import type { Config } from "../config/schema.js";
import { COMMAND_KEYS } from "../config/schema.js";
import { compareIds } from "./load.js";
import { sectionText, type Task } from "./schema.js";
import { waitingOn } from "./select.js";

export const MAX_LOG_LINES = 8;
export const RECENT_LOGS = 3;

const LOG_HEADING = /^##[ \t]+(log|registro|bitácora|bitacora)[ \t]*$/im;
const COMMENT = /<!--[\s\S]*?-->/g;

export function logLines(task: Task): string[] {
  return (sectionText(task.body, "log") ?? "")
    .replace(COMMENT, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
}

export function withLogSection(text: string): string {
  return LOG_HEADING.test(text) ? text : `${text.trimEnd()}\n\n## Log\n`;
}

export function planContext(
  config: Config,
  tasks: Task[],
  current: Task,
  completedAt: Map<string, number> = new Map(),
): string {
  return [planState(tasks, current), commandsSection(config), recentNotes(tasks, completedAt)]
    .filter(Boolean)
    .join("\n\n");
}

function planState(tasks: Task[], current: Task): string {
  const done = tasks.filter((task) => task.meta.status === "done").length;
  const blocked = tasks.filter((task) => task.meta.status === "blocked");
  const others = tasks.filter((task) => task.meta.id !== current.meta.id);
  const upNext = others
    .filter((task) => task.meta.status === "pending")
    .filter((task) => waitingOn(task, tasks).every((id) => id === current.meta.id))
    .slice(0, 3);
  const lines = [
    `- Done: ${done} of ${tasks.length} tasks. You are on ${current.meta.id} (phase ${current.meta.phase}).`,
  ];
  if (blocked.length > 0) lines.push(`- Blocked, do not work on them: ${titles(blocked)}`);
  if (upNext.length > 0) lines.push(`- Up next after this task: ${titles(upNext)}`);
  return ["## Where the plan stands", "", ...lines].join("\n");
}

function commandsSection(config: Config): string {
  const lines = COMMAND_KEYS.flatMap((key) => {
    const command = config.commands[key];
    return command ? [`- ${key}: \`${command}\``] : [];
  });
  return lines.length > 0 ? ["## Project commands", "", ...lines].join("\n") : "";
}

function recentNotes(tasks: Task[], completedAt: Map<string, number>): string {
  const notes = tasks
    .filter((task) => task.meta.status === "done" && logLines(task).length > 0)
    .sort(
      (a, b) =>
        (completedAt.get(b.meta.id) ?? 0) - (completedAt.get(a.meta.id) ?? 0) ||
        compareIds(b.meta.id, a.meta.id),
    )
    .slice(0, RECENT_LOGS)
    .map((task) => `### ${task.meta.id} ${task.meta.title}\n\n${logLines(task).join("\n")}`);
  if (notes.length === 0) return "";
  return ["## Handoff notes from the last finished tasks", ...notes].join("\n\n");
}

function titles(tasks: Task[]): string {
  return tasks.map((task) => `${task.meta.id} ${task.meta.title}`).join("; ");
}
