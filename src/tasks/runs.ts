import { join } from "node:path";
import { readTextIfExists, writeText } from "../core/fs.js";
import { baePaths } from "../core/paths.js";

export function runDir(cwd: string, id: string): string {
  return join(baePaths(cwd).runs, id);
}

export async function readBase(cwd: string, id: string): Promise<string | undefined> {
  return (await readTextIfExists(join(runDir(cwd, id), "base")))?.trim() || undefined;
}

export async function saveBase(cwd: string, id: string, commit: string): Promise<void> {
  await writeText(join(runDir(cwd, id), "base"), `${commit}\n`);
}

export async function writeRunLog(cwd: string, id: string, content: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(runDir(cwd, id), `${stamp}.md`);
  await writeText(path, content);
  return path;
}
