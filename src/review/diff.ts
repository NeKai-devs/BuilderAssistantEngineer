import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { readTextIfExists } from "../core/fs.js";
import { DIFF_FLAGS, excluded, git, unquotePath } from "../core/git.js";
import { isBinaryPath, isLockfile } from "../digest/files.js";
import { truncateText } from "../digest/format.js";
import { GATE_EXCLUDED, type TaskChanges } from "./changes.js";
import { inScope } from "./scope.js";

export type DiffPiece = { path: string; text: string };
export type ReviewDiff = { text: string; shown: string[]; omitted: string[]; generated: string[] };

const MAX_DIFF_CHARS = 60_000;
const MIN_PARTIAL_CHARS = 2_000;
const GENERATED = [/\.min\.(js|css|mjs)$/i, /\.(js|css)\.map$/i];
const DOCS = [/^docs\//, /\.(md|mdx|rst|adoc|txt)$/i];

export async function reviewDiff(
  cwd: string,
  ref: string,
  changes: TaskChanges,
  scope: string[],
  budget = MAX_DIFF_CHARS,
): Promise<ReviewDiff | undefined> {
  const own = new Set(changes.files);
  const raw = await git(cwd, [
    "diff",
    ...DIFF_FLAGS,
    ref,
    "--",
    ".",
    ...GATE_EXCLUDED.map(excluded),
  ]);
  if (raw === undefined) return undefined;
  const tracked = splitDiff(raw).filter((piece) => own.has(piece.path));
  const created = await Promise.all(changes.untracked.map((path) => newFilePiece(cwd, path)));
  return fitBudget([...tracked, ...created], scope, budget);
}

export function fitBudget(pieces: DiffPiece[], scope: string[], budget: number): ReviewDiff {
  const generated = pieces.filter((piece) => isGenerated(piece.path)).map((piece) => piece.path);
  const ranked = pieces
    .filter((piece) => !isGenerated(piece.path))
    .sort((a, b) => rank(a.path, scope) - rank(b.path, scope) || (a.path < b.path ? -1 : 1));
  const parts: string[] = [];
  const shown: string[] = [];
  const omitted: string[] = [];
  let left = budget;
  for (const piece of ranked) {
    if (omitted.length === 0 && piece.text.length <= left) {
      parts.push(piece.text);
      shown.push(piece.path);
      left -= piece.text.length;
      continue;
    }
    if (omitted.length === 0 && left >= MIN_PARTIAL_CHARS) {
      parts.push(truncateText(piece.text, left));
      shown.push(piece.path);
      left = 0;
      continue;
    }
    omitted.push(piece.path);
  }
  const nonce = randomBytes(6).toString("hex");
  const notes = [
    omitted.length > 0 ? `Not shown, over the size budget: ${omitted.join(", ")}` : "",
    generated.length > 0 ? `Not shown, generated files: ${generated.join(", ")}` : "",
  ].filter(Boolean);
  const body = [...parts, ...notes].join("\n\n");
  return {
    text: `<<<DIFF ${nonce}>>>\n${body}\n<<<END DIFF ${nonce}>>>`,
    shown,
    omitted,
    generated,
  };
}

export function splitDiff(diff: string): DiffPiece[] {
  const pieces: DiffPiece[] = [];
  for (const chunk of diff.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;
    const target = /^\+\+\+ (.+)$/m.exec(chunk)?.[1];
    const source = /^--- (.+)$/m.exec(chunk)?.[1];
    const named = [target, source]
      .map((raw) => (raw ? unquotePath(raw.replace(/\t$/, "")) : undefined))
      .find((path) => path !== undefined && path !== "/dev/null");
    const path = named ? named.replace(/^[ab]\//, "") : headerPath(chunk.split("\n", 1)[0] ?? "");
    if (path) pieces.push({ path, text: chunk.trimEnd() });
  }
  return pieces;
}

function headerPath(header: string): string | undefined {
  const quoted = /^diff --git "a\/(?:[^"\\]|\\.)*" ("b\/(?:[^"\\]|\\.)*")$/.exec(header)?.[1];
  if (quoted) return unquotePath(quoted).slice(2);
  return /^diff --git a\/(.+) b\/\1$/.exec(header)?.[1];
}

function rank(path: string, scope: string[]): number {
  if (scope.length > 0 && inScope(path, scope)) return 0;
  if (isLockfile(path)) return 3;
  return DOCS.some((pattern) => pattern.test(path)) ? 2 : 1;
}

function isGenerated(path: string): boolean {
  return GENERATED.some((pattern) => pattern.test(path));
}

async function newFilePiece(cwd: string, path: string): Promise<DiffPiece> {
  if (isBinaryPath(path)) return { path, text: `new binary file: ${path}` };
  const text = (await readTextIfExists(join(cwd, ...path.split("/")))) ?? "";
  return { path, text: `new file: ${path}\n${text.trimEnd()}` };
}
