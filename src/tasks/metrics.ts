import { type Attempt, readAttempts } from "./attempts.js";

export type TaskMetrics = {
  id: string;
  attempts: number;
  durationMs: number;
  doneOnFirst: boolean;
  completedAt?: number;
};

export type RunMetrics = {
  tasks: Map<string, TaskMetrics>;
  attempts: number;
  attempted: number;
  doneOnFirst: number;
  regressionsCaught: number;
  done: number;
  doneDurationMs: number;
  costUsd: number;
  priced: number;
};

export async function readMetrics(cwd: string, ids: string[]): Promise<RunMetrics> {
  const history = await Promise.all(
    ids.map(async (id) => [id, await readAttempts(cwd, id)] as const),
  );
  const tasks = new Map(
    history
      .filter(([, attempts]) => attempts.length > 0)
      .map(([id, attempts]) => [id, taskMetrics(id, attempts)]),
  );
  const all = history.flatMap(([, attempts]) => attempts);
  const finished = [...tasks.values()].filter((task) => task.completedAt !== undefined);
  return {
    tasks,
    attempts: all.length,
    attempted: tasks.size,
    doneOnFirst: [...tasks.values()].filter((task) => task.doneOnFirst).length,
    regressionsCaught: all.filter((attempt) => attempt.stage === "regression").length,
    done: finished.length,
    doneDurationMs: finished.reduce((total, task) => total + task.durationMs, 0),
    costUsd: all.reduce((total, attempt) => total + (attempt.costUsd ?? 0), 0),
    priced: all.filter((attempt) => attempt.costUsd !== undefined).length,
  };
}

export function completionTimes(metrics: RunMetrics): Map<string, number> {
  return new Map(
    [...metrics.tasks.values()].flatMap((task) =>
      task.completedAt === undefined ? [] : [[task.id, task.completedAt] as const],
    ),
  );
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function taskMetrics(id: string, attempts: Attempt[]): TaskMetrics {
  const done = attempts.filter((attempt) => attempt.outcome === "done").at(-1);
  return {
    id,
    attempts: attempts.length,
    durationMs: attempts.reduce((total, attempt) => total + attempt.durationMs, 0),
    doneOnFirst: attempts[0]?.outcome === "done",
    ...(done ? { completedAt: Date.parse(done.startedAt) + done.durationMs } : {}),
  };
}
