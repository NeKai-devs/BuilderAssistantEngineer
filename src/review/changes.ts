import { stat } from "node:fs/promises";
import { join } from "node:path";
import { readTextIfExists } from "../core/fs.js";
import { git, isGitRepo, lines, resolveBase } from "../core/git.js";
import { isBinaryPath } from "../digest/files.js";

export type AddedText = { path: string; text: string };
export type TaskChanges = { files: string[]; added: AddedText[] };

const MAX_NEW_FILE_BYTES = 1_000_000;
const TARGET_FILE = /^\+\+\+ (?:b\/)?(.+)$/;

export async function taskChanges(
  cwd: string,
  base: string | undefined,
  exclude: string[],
): Promise<TaskChanges | undefined> {
  if (!(await isGitRepo(cwd))) return undefined;
  const pathspec = ["--", ".", ...exclude.map((path) => `:(exclude)${path}`)];
  const ref = await resolveBase(cwd, base);
  const [names, patch, untracked] = await Promise.all([
    git(cwd, ["diff", "--name-only", ref, ...pathspec]),
    git(cwd, ["diff", "--no-color", "--no-ext-diff", "-U0", ref, ...pathspec]),
    git(cwd, ["ls-files", "--others", "--exclude-standard", ...pathspec]),
  ]);
  const created = lines(untracked);
  const contents = await Promise.all(created.map((path) => newFileText(cwd, path)));
  return {
    files: [...new Set([...lines(names), ...created])].sort(),
    added: [
      ...addedLines(patch ?? ""),
      ...created.map((path, index) => ({ path, text: contents[index] ?? "" })),
    ],
  };
}

export function addedLines(patch: string): AddedText[] {
  const byFile = new Map<string, string[]>();
  let current: string | undefined;
  let inHeader = false;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      current = undefined;
      inHeader = true;
      continue;
    }
    const target = inHeader ? TARGET_FILE.exec(line) : null;
    if (target) {
      current = target[1];
      inHeader = false;
      continue;
    }
    if (!inHeader && current && line.startsWith("+")) {
      byFile.set(current, [...(byFile.get(current) ?? []), line.slice(1)]);
    }
  }
  return [...byFile].map(([path, added]) => ({ path, text: added.join("\n") }));
}

async function newFileText(cwd: string, path: string): Promise<string> {
  const target = join(cwd, ...path.split("/"));
  const info = await stat(target).catch(() => undefined);
  if (!info?.isFile() || info.size > MAX_NEW_FILE_BYTES || isBinaryPath(path)) return "";
  return (await readTextIfExists(target)) ?? "";
}
