import type { CommandContext } from "../commands/context.js";
import { git, gitPaths, gitRun } from "../core/git.js";
import type { Capture } from "../gates/capture.js";
import { t } from "../i18n/index.js";
import { taskChanges } from "../review/changes.js";
import type { TaskMeta } from "../tasks/schema.js";
import { currentBranch, readRun } from "./branch.js";

const PATH_CHUNK = 100;
const HEADER_MAX = 100;
const COMMIT_TIMEOUT_MS = 10 * 60_000;
const DETAIL_LINES = 20;

export type Committed = { ok: true; sha: string } | { ok: false; details: string };
export type CommitOptions = { verify: boolean };

export async function onRunBranch(cwd: string): Promise<boolean> {
  const run = await readRun(cwd);
  return run !== undefined && run.branch === (await currentBranch(cwd));
}

export async function commitTask(
  ctx: CommandContext,
  capture: Capture,
  meta: TaskMeta,
  options: CommitOptions,
): Promise<void> {
  if (!capture.git || !(await onRunBranch(ctx.cwd))) return;
  const view = await taskChanges(ctx.cwd, capture);
  if (!view.ok) {
    ctx.prompter.warn(t("commit.failed", { id: capture.id, details: view.reason }));
    return;
  }
  const own = await gitPaths(ctx.cwd, [
    "diff",
    "--name-only",
    "HEAD",
    "--",
    ".bae",
    ":(exclude).bae/tmp",
  ]);
  const paths = [...new Set([...view.changes.files, capture.path, ...(own ?? [])])];
  const result = await commitPaths(ctx.cwd, paths, taskMessage(meta), options);
  if (!result.ok) {
    ctx.prompter.warn(t("commit.failed", { id: capture.id, details: result.details }));
    return;
  }
  const branch = (await currentBranch(ctx.cwd)) ?? "HEAD";
  ctx.prompter.info(t("commit.done", { id: capture.id, sha: result.sha, branch }));
}

export function taskMessage(meta: TaskMeta): string[] {
  const prefix = `${meta.type}: `;
  const suffix = ` (${meta.id})`;
  const room = HEADER_MAX - prefix.length - suffix.length;
  return [`${prefix}${fit(subject(meta.title), room)}${suffix}`, `Bae-Task: ${meta.id}`];
}

export async function commitPaths(
  cwd: string,
  paths: string[],
  message: string[],
  options: CommitOptions,
): Promise<Committed> {
  const known = await addable(cwd, paths);
  if (known.length === 0) return { ok: false, details: "nothing to commit" };
  const list = known.join("\0");
  const added = await gitRun(
    cwd,
    ["--literal-pathspecs", "add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
    list,
  );
  if (added.exitCode !== 0) return { ok: false, details: tail(added.stderr) };
  const committed = await gitRun(
    cwd,
    [
      "--literal-pathspecs",
      "commit",
      "--quiet",
      ...(options.verify ? [] : ["--no-verify"]),
      ...message.flatMap((paragraph) => ["-m", paragraph]),
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
    ],
    list,
    COMMIT_TIMEOUT_MS,
  );
  if (committed.exitCode !== 0) {
    return { ok: false, details: tail(`${committed.stderr}\n${committed.stdout}`) };
  }
  const sha = (await git(cwd, ["rev-parse", "--short", "HEAD"]))?.trim() ?? "";
  return { ok: true, sha };
}

function subject(title: string): string {
  const trimmed = title.trim().replace(/\.+$/, "");
  return /^[A-Z][a-z]/.test(trimmed) ? `${trimmed[0]?.toLowerCase()}${trimmed.slice(1)}` : trimmed;
}

function fit(text: string, room: number): string {
  return text.length <= room ? text : `${text.slice(0, room - 1).trimEnd()}…`;
}

function tail(text: string): string {
  return text.trim().split(/\r?\n/).slice(-DETAIL_LINES).join("\n");
}

async function addable(cwd: string, paths: string[]): Promise<string[]> {
  const found = new Set<string>();
  for (let start = 0; start < paths.length; start += PATH_CHUNK) {
    const chunk = paths.slice(start, start + PATH_CHUNK);
    const listed = await git(cwd, [
      "--literal-pathspecs",
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...chunk,
    ]);
    for (const path of (listed ?? "").split("\0")) if (path) found.add(path);
  }
  return paths.filter((path) => found.has(path));
}
