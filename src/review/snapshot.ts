import { stat } from "node:fs/promises";
import { join } from "node:path";
import { excluded, git, gitPaths, isGitRepo } from "../core/git.js";

export type Snapshot = Record<string, string | null>;

const HASH_BATCH = 100;

export async function takeSnapshot(cwd: string, exclude: string[]): Promise<Snapshot> {
  if (!(await isGitRepo(cwd))) return {};
  const pathspec = ["--", ".", ...exclude.map(excluded)];
  const [changed, untracked] = await Promise.all([
    gitPaths(cwd, ["diff", "--name-only", "--no-renames", "HEAD", ...pathspec]),
    gitPaths(cwd, ["ls-files", "--others", "--exclude-standard", ...pathspec]),
  ]);
  return hashPaths(cwd, [...new Set([...(changed ?? []), ...(untracked ?? [])])]);
}

export async function unchangedSince(
  cwd: string,
  snapshot: Snapshot,
  files: string[],
): Promise<Set<string>> {
  const known = files.filter((file) => Object.hasOwn(snapshot, file));
  const current = await hashPaths(cwd, known);
  return new Set(known.filter((file) => current[file] === snapshot[file]));
}

export async function hashPaths(cwd: string, paths: string[]): Promise<Snapshot> {
  const snapshot: Snapshot = {};
  const present: string[] = [];
  for (const path of paths) {
    const info = await stat(join(cwd, ...path.split("/"))).catch(() => undefined);
    if (info?.isFile()) present.push(path);
    else snapshot[path] = null;
  }
  for (let start = 0; start < present.length; start += HASH_BATCH) {
    const batch = present.slice(start, start + HASH_BATCH);
    const hashes = (await git(cwd, ["hash-object", "--", ...batch]))?.split(/\r?\n/) ?? [];
    batch.forEach((path, index) => {
      snapshot[path] = hashes[index]?.trim() || null;
    });
  }
  return snapshot;
}
