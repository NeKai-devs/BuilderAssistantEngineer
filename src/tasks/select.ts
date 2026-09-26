import { compareIds } from "./load.js";
import type { Task } from "./schema.js";

export function orderTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.meta.phase - b.meta.phase || compareIds(a.meta.id, b.meta.id));
}

export function pickNext(tasks: Task[]): Task | undefined {
  const ordered = orderTasks(tasks);
  const inProgress = ordered.find((task) => task.meta.status === "in_progress");
  if (inProgress) return inProgress;
  return ordered.find(
    (task) => task.meta.status === "pending" && waitingOn(task, tasks).length === 0,
  );
}

export function waitingOn(task: Task, tasks: Task[]): string[] {
  const done = new Set(
    tasks.filter((other) => other.meta.status === "done").map((other) => other.meta.id),
  );
  return task.meta.depends_on.filter((id) => !done.has(id));
}
