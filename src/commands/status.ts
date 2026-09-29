import pc from "picocolors";
import { t } from "../i18n/index.js";
import { branchExists, currentBranch, readRun, runCommits } from "../next/branch.js";
import { blockedReason } from "../tasks/attempts.js";
import { type LoadedTask, loadTaskFiles } from "../tasks/load.js";
import { formatDuration, type RunMetrics, readMetrics } from "../tasks/metrics.js";
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
  needs_review: pc.yellow("?"),
};

export async function runStatus(ctx: CommandContext): Promise<void> {
  const loaded = await loadTaskFiles(ctx.cwd);
  if (loaded.length === 0) {
    ctx.print(`${t("status.empty", { command: `${CLI} plan` })}\n`);
    return;
  }
  const metrics = await readMetrics(
    ctx.cwd,
    loaded.map((item) => item.id),
  );
  const blocked = loaded.filter((item) => item.task?.meta.status === "blocked");
  const reasons = new Map(
    await Promise.all(
      blocked.map(
        async (item) => [item.id, (await blockedReason(ctx.cwd, item.id)) ?? ""] as const,
      ),
    ),
  );
  const run = await runSection(ctx.cwd);
  ctx.print(`${[run, renderStatus(loaded, metrics, reasons)].filter(Boolean).join("\n\n")}\n`);
}

async function runSection(cwd: string): Promise<string> {
  const run = await readRun(cwd);
  if (!run || !(await branchExists(cwd, run.branch))) return "";
  const current = await currentBranch(cwd);
  if (current !== run.branch) {
    return t("status.runElsewhere", { branch: run.branch, current: current ?? "HEAD" });
  }
  const commits = await runCommits(cwd, run);
  const lines = commits.map((commit) => `  ${pc.dim(commit.sha)} ${commit.subject}`);
  return [
    pc.bold(t("status.run", { branch: run.branch, from: run.from })),
    ...(lines.length > 0 ? lines : [`  ${pc.dim(t("status.noCommits"))}`]),
  ].join("\n");
}

export function renderStatus(
  loaded: LoadedTask[],
  metrics?: RunMetrics,
  reasons: Map<string, string> = new Map(),
): string {
  const tasks = loaded.flatMap((item) => (item.task ? [item.task] : []));
  const phases = [...new Set(orderTasks(tasks).map((task) => task.meta.phase))];
  const blocks = phases.map((phase) =>
    renderPhase(
      phase,
      orderTasks(tasks).filter((task) => task.meta.phase === phase),
      tasks,
      metrics,
    ),
  );
  const invalid = loaded.filter((item) => item.error).map((item) => `${pc.red("!")} ${item.error}`);
  const why = [...reasons]
    .filter(([, reason]) => reason !== "")
    .map(([id, reason]) => `${SYMBOLS.blocked} ${t("status.blockedReason", { id, reason })}`);
  const review = tasks
    .filter((task) => task.meta.status === "needs_review")
    .map(
      (task) =>
        `${SYMBOLS.needs_review} ${t("status.reviewReason", { id: task.meta.id, reason: task.meta.review_note ?? "" })}`,
    );
  return [
    ...blocks,
    ...(why.length > 0 ? [why.join("\n")] : []),
    ...(review.length > 0 ? [review.join("\n")] : []),
    ...(invalid.length > 0 ? [invalid.join("\n")] : []),
    summary(tasks),
    ...(metrics && metrics.attempts > 0 ? [renderMetrics(metrics)] : []),
  ].join("\n\n");
}

function renderPhase(phase: number, tasks: Task[], all: Task[], metrics?: RunMetrics): string {
  const done = tasks.filter((task) => task.meta.status === "done").length;
  const header = `${pc.bold(t("status.phase", { phase }))}  ${bar(done, tasks.length)} ${done}/${tasks.length}`;
  return [header, ...tasks.map((task) => renderTask(task, all, metrics))].join("\n");
}

function renderTask(task: Task, all: Task[], metrics?: RunMetrics): string {
  const { id, size, risk, status, title } = task.meta;
  const waiting = status === "pending" ? waitingOn(task, all) : [];
  const note =
    waiting.length > 0 ? pc.dim(`  ${t("status.waiting", { ids: waiting.join(", ") })}`) : "";
  const label = status === "done" ? "" : pc.dim(`  ${status}`);
  const runs = metrics?.tasks.get(id);
  const effort = runs
    ? pc.dim(
        `  ${t("status.taskRuns", { attempts: runs.attempts, time: formatDuration(runs.durationMs) })}`,
      )
    : "";
  return `  ${SYMBOLS[status]} ${id}  ${size}  ${risk.padEnd(6)}  ${truncate(title)}${label}${note}${effort}`;
}

function summary(tasks: Task[]): string {
  const done = tasks.filter((task) => task.meta.status === "done").length;
  const next = pickNext(tasks);
  const nextText = next
    ? t("status.next", { id: next.meta.id, title: next.meta.title })
    : t("status.noNext");
  return `${t("status.total", { done, total: tasks.length, percent: percent(done, tasks.length) })} · ${nextText}`;
}

function renderMetrics(metrics: RunMetrics): string {
  const average = (metrics.attempts / Math.max(metrics.attempted, 1)).toFixed(1);
  const lines = [
    t("status.attempts", { attempts: metrics.attempts, tasks: metrics.attempted, average }),
    t("status.firstAttempt", {
      count: metrics.doneOnFirst,
      tasks: metrics.attempted,
      percent: percent(metrics.doneOnFirst, metrics.attempted),
    }),
    t("status.regressions", { count: metrics.regressionsCaught }),
  ];
  if (metrics.done > 0) {
    lines.push(
      t("status.time", {
        average: formatDuration(metrics.doneDurationMs / metrics.done),
        total: formatDuration(metrics.doneDurationMs),
      }),
    );
  }
  return [pc.bold(t("status.metrics")), ...lines.map((line) => `  ${line}`)].join("\n");
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function bar(done: number, total: number): string {
  const filled = total > 0 ? Math.round((done / total) * BAR_WIDTH) : 0;
  return pc.green("█".repeat(filled)) + pc.dim("░".repeat(BAR_WIDTH - filled));
}

function truncate(text: string): string {
  return text.length > TITLE_WIDTH ? `${text.slice(0, TITLE_WIDTH - 1)}…` : text;
}
