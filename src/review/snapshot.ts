import { stat } from "node:fs/promises";
import { join } from "node:path";
import { readTextIfExists, writeText } from "../core/fs.js";
import { git, isGitRepo, lines } from "../core/git.js";
import { asRecord, parseObject } from "../core/json.js";
import { runDir } from "../tasks/runs.js";

export type Snapshot = Record<string, string | null>;

const SNAPSHOT_FILE = "snapshot.json";
const HASH_BATCH = 100;

export async function takeSnapshot(cwd: string, exclude: string[]): Promise<Snapshot | undefined> {
  if (!(await isGitRepo(cwd))) return undefined;
  const pathspec = ["--", ".", ...exclude.map((path) => `:(exclude)${path}`)];
  const [changed, untracked] = await Promise.all([
    git(cwd, ["diff", "--name-only", "HEAD", ...pathspec]),
    git(cwd, ["ls-files", "--others", "--exclude-standard", ...pathspec]),
  ]);
  return hashPaths(cwd, [...new Set([...lines(changed), ...lines(untracked)])]);
}

export async function saveSnapshot(cwd: string, id: string, snapshot: Snapshot): Promise<void> {
  await writeText(join(runDir(cwd, id), SNAPSHOT_FILE), `${JSON.stringify(snapshot, null, 2)}\n`);
}

export async function readSnapshot(cwd: string, id: string): Promise<Snapshot> {
  const data = asRecord(
    parseObject((await readTextIfExists(join(runDir(cwd, id), SNAPSHOT_FILE))) ?? ""),
  );
  return Object.fromEntries(
    Object.entries(data).map(([path, hash]) => [path, typeof hash === "string" ? hash : null]),
  );
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

export async function markUnchanged(cwd: string, id: string, paths: string[]): Promise<void> {
  if (!(await isGitRepo(cwd))) return;
  const snapshot = await readSnapshot(cwd, id);
  await saveSnapshot(cwd, id, { ...snapshot, ...(await hashPaths(cwd, paths)) });
}

async function hashPaths(cwd: string, paths: string[]): Promise<Snapshot> {
  const snapshot: Snapshot = {};
  const present: string[] = [];
  for (const path of paths) {
    const info = await stat(join(cwd, ...path.split("/"))).catch(() => undefined);
    if (info?.isFile()) present.push(path);
    else snapshot[path] = null;
  }
  for (let start = 0; start < present.length; start += HASH_BATCH) {
    const batch = present.slice(start, start + HASH_BATCH);
    const hashes = lines(await git(cwd, ["hash-object", "--", ...batch]));
    batch.forEach((path, index) => {
      snapshot[path] = hashes[index] ?? null;
    });
  }
  return snapshot;
}
