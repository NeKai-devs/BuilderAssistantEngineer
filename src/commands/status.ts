import pc from "picocolors";
import { t } from "../i18n/index.js";
import { type LoadedTask, loadTaskFiles } from "../tasks/load.js";
import type { Task, TaskStatus } from "../tasks/schema.js";
import { orderTasks, pickNext, waitingOn } from "../tasks/select.js";
import type { CommandContext } from "./context.js";
import { CLI } from "./shared.js";

const BAR_WIDTH = 20;
const TITLE_WIDTH = 56;

const SYMBOLS: Record<TaskStatus, string> = {
  done: pc.green("✔"),
  in_progress: pc.yellow("▶"),
  pending: pc.dim("○"),
  blocked: pc.red("✖"),
};

export async function runStatus(ctx: CommandContext): Promise<void> {
  const loaded = await loadTaskFiles(ctx.cwd);
  if (loaded.length === 0) {
    ctx.print(`${t("status.empty", { command: `${CLI} plan` })}\n`);
    return;
  }
  ctx.print(`${renderStatus(loaded)}\n`);
}

export function renderStatus(loaded: LoadedTask[]): string {
  const tasks = loaded.flatMap((item) => (item.task ? [item.task] : []));
  const phases = [...new Set(orderTasks(tasks).map((task) => task.meta.phase))];
  const blocks = phases.map((phase) =>
    renderPhase(
      phase,
      orderTasks(tasks).filter((task) => task.meta.phase === phase),
      tasks,
    ),
  );
  const invalid = loaded.filter((item) => item.error).map((item) => `${pc.red("!")} ${item.error}`);
  return [...blocks, ...(invalid.length > 0 ? [invalid.join("\n")] : []), summary(tasks)].join(
    "\n\n",
  );
}

function renderPhase(phase: number, tasks: Task[], all: Task[]): string {
  const done = tasks.filter((task) => task.meta.status === "done").length;
  const header = `${pc.bold(t("status.phase", { phase }))}  ${bar(done, tasks.length)} ${done}/${tasks.length}`;
  return [header, ...tasks.map((task) => renderTask(task, all))].join("\n");
}

function renderTask(task: Task, all: Task[]): string {
  const { id, size, risk, status, title } = task.meta;
  const waiting = status === "pending" ? waitingOn(task, all) : [];
  const note =
    waiting.length > 0 ? pc.dim(`  ${t("status.waiting", { ids: waiting.join(", ") })}`) : "";
  const label = status === "done" ? "" : pc.dim(`  ${status}`);
  return `  ${SYMBOLS[status]} ${id}  ${size}  ${risk.padEnd(6)}  ${truncate(title)}${label}${note}`;
}

function summary(tasks: Task[]): string {
  const done = tasks.filter((task) => task.meta.status === "done").length;
  const percent = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
  const next = pickNext(tasks);
  const nextText = next
    ? t("status.next", { id: next.meta.id, title: next.meta.title })
    : t("status.noNext");
  return `${t("status.total", { done, total: tasks.length, percent })} · ${nextText}`;
}

function bar(done: number, total: number): string {
  const filled = total > 0 ? Math.round((done / total) * BAR_WIDTH) : 0;
  return pc.green("█".repeat(filled)) + pc.dim("░".repeat(BAR_WIDTH - filled));
}

function truncate(text: string): string {
  return text.length > TITLE_WIDTH ? `${text.slice(0, TITLE_WIDTH - 1)}…` : text;
}
