import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandContext } from "../commands/context.js";
import { git, gitPaths, gitRun } from "../core/git.js";
import type { Capture } from "../gates/capture.js";
import { t } from "../i18n/index.js";
import { taskChanges } from "../review/changes.js";
import { currentBranch } from "./branch.js";

const PATH_CHUNK = 100;

export type Committed = { ok: true; sha: string } | { ok: false; details: string };

export async function commitTask(
  ctx: CommandContext,
  capture: Capture,
  title: string,
): Promise<void> {
  if (!capture.git) return;
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
  const result = await commitPaths(ctx.cwd, paths, `bae: ${capture.id} ${title}`);
  if (!result.ok) {
    ctx.prompter.warn(t("commit.failed", { id: capture.id, details: result.details }));
    return;
  }
  const branch = (await currentBranch(ctx.cwd)) ?? "HEAD";
  ctx.prompter.info(t("commit.done", { id: capture.id, sha: result.sha, branch }));
}

export async function commitPaths(
  cwd: string,
  paths: string[],
  message: string,
): Promise<Committed> {
  const known = await addable(cwd, paths);
  if (known.length === 0) return { ok: false, details: "nothing to commit" };
  const list = known.join("\0");
  const hooks = await mkdtemp(join(tmpdir(), "bae-hooks-"));
  try {
    const added = await gitRun(
      cwd,
      ["--literal-pathspecs", "add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
      list,
    );
    if (added.exitCode !== 0) return { ok: false, details: added.stderr.trim() };
    const committed = await gitRun(
      cwd,
      [
        "--literal-pathspecs",
        "-c",
        `core.hooksPath=${hooks.replace(/\\/g, "/")}`,
        "commit",
        "--no-verify",
        "--quiet",
        "-m",
        message,
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
      ],
      list,
    );
    if (committed.exitCode !== 0) {
      return { ok: false, details: (committed.stderr || committed.stdout).trim() };
    }
    const sha = (await git(cwd, ["rev-parse", "--short", "HEAD"]))?.trim() ?? "";
    return { ok: true, sha };
  } finally {
    await rm(hooks, { recursive: true, force: true });
  }
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
