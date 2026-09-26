import { join } from "node:path";
import { readTextIfExists, writeText } from "../core/fs.js";
import { setFrontmatterFields } from "./frontmatter.js";
import { withLogSection } from "./handoff.js";
import type { Task, TaskStatus } from "./schema.js";

export async function setTaskStatus(cwd: string, task: Task, status: TaskStatus): Promise<Task> {
  const path = join(cwd, ...task.path.split("/"));
  const current = (await readTextIfExists(path)) ?? task.text;
  const text = setFrontmatterFields(status === "in_progress" ? withLogSection(current) : current, {
    status,
  });
  await writeText(path, text);
  return { ...task, text, meta: { ...task.meta, status } };
}
