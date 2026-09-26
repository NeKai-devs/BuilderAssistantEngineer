import { join } from "node:path";
import { writeText } from "../core/fs.js";
import { repoState } from "../core/state.js";

export function runDir(cwd: string, id: string): string {
  return join(repoState(cwd), "runs", id);
}

export async function writeRunLog(cwd: string, id: string, content: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(runDir(cwd, id), `${stamp}.md`);
  await writeText(path, content);
  return path;
}
