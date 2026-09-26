import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { FormatError } from "../core/errors.js";
import { readTextIfExists } from "../core/fs.js";
import { parseTask, TASK_PATH, TASKS_DIR, type Task } from "./schema.js";

export type LoadedTask = { path: string; id: string; text: string; task?: Task; error?: string };

export async function loadTaskFiles(cwd: string): Promise<LoadedTask[]> {
  const names = await listMarkdown(join(cwd, ...TASKS_DIR.split("/")));
  const loaded = await Promise.all(names.map((name) => loadOne(cwd, `${TASKS_DIR}/${name}`)));
  return loaded
    .filter((task): task is LoadedTask => task !== undefined)
    .sort((a, b) => compareIds(a.id, b.id));
}

export function compareIds(a: string, b: string): number {
  return Number(a.slice(2)) - Number(b.slice(2)) || (a < b ? -1 : a > b ? 1 : 0);
}

async function loadOne(cwd: string, path: string): Promise<LoadedTask | undefined> {
  const id = TASK_PATH.exec(path)?.[1];
  const text = await readTextIfExists(join(cwd, ...path.split("/")));
  if (!id || text === undefined) return undefined;
  try {
    return { path, id, text, task: parseTask(path, text) };
  } catch (error) {
    if (!(error instanceof FormatError)) throw error;
    return { path, id, text, error: error.message };
  }
}

async function listMarkdown(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return [];
  }
}
