import { join } from "node:path";
import { readTextIfExists, writeText } from "./fs.js";

export const BAE_IGNORED = [".bae/runs/", ".bae/tmp/"];

export async function ensureGitignore(cwd: string): Promise<string[]> {
  const path = join(cwd, ".gitignore");
  const current = (await readTextIfExists(path)) ?? "";
  const present = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = BAE_IGNORED.filter((entry) => !present.has(entry));
  if (missing.length === 0) return [];
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  await writeText(path, `${current}${separator}${missing.join("\n")}\n`);
  return missing;
}
