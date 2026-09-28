import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config/schema.js";
import { readTextIfExists } from "../core/fs.js";

const AGENT_DIRS = [".claude/agents", ".opencode/agent"];
const DEFAULT_REVIEWER =
  "A strict senior code reviewer. Checks that the changes meet every acceptance criterion, follow the project conventions, include tests, stay within the task scope and introduce no security issues.";

export async function findReviewer(cwd: string, backend: Config["backend"]): Promise<string> {
  const dirs = backend === "opencode" ? [...AGENT_DIRS].reverse() : AGENT_DIRS;
  for (const dir of dirs) {
    const path = join(cwd, ...dir.split("/"));
    const name = (await listNames(path)).find(
      (entry) => /review/i.test(entry) && entry.endsWith(".md"),
    );
    if (name) return (await readTextIfExists(join(path, name))) ?? DEFAULT_REVIEWER;
  }
  return DEFAULT_REVIEWER;
}

async function listNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}
