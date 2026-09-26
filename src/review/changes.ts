import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isSymlink, looksBinary, readTextIfExists } from "../core/fs.js";
import {
  DIFF_FLAGS,
  EMPTY_TREE,
  excluded,
  git,
  gitPaths,
  isGitRepo,
  unquotePath,
  verifyCommit,
} from "../core/git.js";
import { BAE_DIR } from "../core/paths.js";
import type { Capture } from "../gates/capture.js";
import { TASKS_DIR } from "../gates/contract.js";
import { ignoreMatcher, untrackedFiles } from "../gates/ignore-rules.js";
import { unchangedSince } from "./snapshot.js";

export type AddedText = { path: string; text: string };
export type TaskChanges = {
  files: string[];
  added: AddedText[];
  removed: AddedText[];
  deleted: string[];
  untracked: string[];
};
export type ChangeView =
  | { ok: true; ref: string; changes: TaskChanges; before: Set<string> }
  | { ok: false; reason: "noGit" | "noBase" | "gitError" };

const MAX_NEW_FILE_BYTES = 1_000_000;
const MAX_SUSPICIOUS_LINES = 5_000;
const MAX_LINE_CHARS = 2_000;
const SUSPICIOUS =
  /AKIA|gh[pousr]_|github_pat_|glpat-|eyJ|xox[abprs]-|\bsk-|[rs]k_live_|AIza|npm_|PRIVATE KEY|passw|secret|api[_-]?key|token|:\/\/[^\s:@/]+:[^\s@/]+@|["'`][A-Za-z0-9+/_-]{40,}/i;
export const GATE_EXCLUDED = [BAE_DIR, TASKS_DIR];

export async function taskChanges(cwd: string, capture: Capture): Promise<ChangeView> {
  if (!capture.git || !(await isGitRepo(cwd))) return { ok: false, reason: "noGit" };
  const ref = capture.base ? await verifyCommit(cwd, capture.base) : EMPTY_TREE;
  if (!ref) return { ok: false, reason: "noBase" };
  const pathspec = ["--", ".", ...GATE_EXCLUDED.map(excluded)];
  const [names, deleted, patch, untracked] = await Promise.all([
    gitPaths(cwd, ["diff", "--name-only", "--no-renames", ref, ...pathspec]),
    gitPaths(cwd, ["diff", "--name-only", "--no-renames", "--diff-filter=D", ref, ...pathspec]),
    git(cwd, ["diff", ...DIFF_FLAGS, "-U0", ref, ...pathspec]),
    untrackedFiles(cwd, ignoreMatcher(capture.ignore)),
  ]);
  if (!names || !deleted || patch === undefined || !untracked) {
    return { ok: false, reason: "gitError" };
  }
  const created = untracked.filter((path) => !isExcluded(path));
  const lines = diffLines(patch);
  const contents = await Promise.all(created.map((path) => newFileText(cwd, path)));
  const all: TaskChanges = {
    files: [...new Set([...names, ...created])].sort(),
    added: [
      ...lines.added,
      ...created.map((path, index) => ({ path, text: contents[index] ?? "" })),
    ],
    removed: lines.removed,
    deleted,
    untracked: created,
  };
  const before = await unchangedSince(cwd, capture.snapshot, all.files);
  return { ok: true, ref, changes: withoutPaths(all, before), before };
}

export function diffLines(patch: string): { added: AddedText[]; removed: AddedText[] } {
  const added = new Map<string, string[]>();
  const removed = new Map<string, string[]>();
  let current: string | undefined;
  let source: string | undefined;
  let inHeader = false;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      current = undefined;
      source = undefined;
      inHeader = true;
      continue;
    }
    if (inHeader && line.startsWith("--- ")) {
      source = headerPath(line.slice(4));
      continue;
    }
    if (inHeader && line.startsWith("+++ ")) {
      const target = headerPath(line.slice(4));
      current = target === "/dev/null" ? source : target;
      inHeader = false;
      continue;
    }
    if (inHeader || !current) continue;
    const into = line.startsWith("+") ? added : line.startsWith("-") ? removed : undefined;
    into?.set(current, [...(into.get(current) ?? []), line.slice(1)]);
  }
  const texts = (map: Map<string, string[]>) =>
    [...map].map(([path, lines]) => ({ path, text: lines.join("\n") }));
  return { added: texts(added), removed: texts(removed) };
}

function headerPath(raw: string): string {
  const path = unquotePath(raw.replace(/\t$/, ""));
  return path === "/dev/null" ? path : path.replace(/^[ab]\//, "");
}

function withoutPaths(changes: TaskChanges, skip: Set<string>): TaskChanges {
  const keep = (path: string) => !skip.has(path);
  return {
    files: changes.files.filter(keep),
    added: changes.added.filter((item) => keep(item.path)),
    removed: changes.removed.filter((item) => keep(item.path)),
    deleted: changes.deleted.filter(keep),
    untracked: changes.untracked.filter(keep),
  };
}

function isExcluded(path: string): boolean {
  return GATE_EXCLUDED.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

async function newFileText(cwd: string, path: string): Promise<string> {
  const target = join(cwd, ...path.split("/"));
  const info = await stat(target).catch(() => undefined);
  if (!info?.isFile() || (await isSymlink(target)) || (await looksBinary(target))) return "";
  if (info.size > MAX_NEW_FILE_BYTES) return suspiciousLines(target);
  return (await readTextIfExists(target)) ?? "";
}

async function suspiciousLines(target: string): Promise<string> {
  const kept: string[] = [];
  const lines = createInterface({ input: createReadStream(target, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (SUSPICIOUS.test(line)) kept.push(line.slice(0, MAX_LINE_CHARS));
    if (kept.length >= MAX_SUSPICIOUS_LINES) break;
  }
  lines.close();
  return kept.join("\n");
}
