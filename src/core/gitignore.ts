import { join } from "node:path";
import { readTextIfExists, writeText } from "./fs.js";
import { git } from "./git.js";

export const BAE_IGNORED = [".bae/tmp/"];

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

export async function userChanges(cwd: string, status: string, own: string[]): Promise<string[]> {
  const paths = status
    .split("\n")
    .map((line) => line.slice(3).replace(/^"|"$/g, ""))
    .filter((path) => path && !own.some((prefix) => path.startsWith(prefix)));
  const ours = paths.includes(".gitignore") && (await onlyBaeIgnored(cwd));
  return ours ? paths.filter((path) => path !== ".gitignore") : paths;
}

async function onlyBaeIgnored(cwd: string): Promise<boolean> {
  const diff = (await git(cwd, ["diff", "--no-ext-diff", "-U0", "HEAD", "--", ".gitignore"])) ?? "";
  const tracked = diff.trim() !== "";
  const changes = tracked
    ? diff.split("\n").filter((line) => /^[+-](?![+-]{2} )/.test(line))
    : ((await readTextIfExists(join(cwd, ".gitignore"))) ?? "")
        .split("\n")
        .map((line) => `+${line}`);
  return changes.every(
    (line) => line === "+" || (line.startsWith("+") && BAE_IGNORED.includes(line.slice(1).trim())),
  );
}
