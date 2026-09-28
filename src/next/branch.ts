import { join } from "node:path";
import { z } from "zod";
import type { CommandContext } from "../commands/context.js";
import { ExitCode } from "../core/errors.js";
import { readTextIfExists, writeText } from "../core/fs.js";
import { EMPTY_TREE, git, gitRun, headCommit, isGitRepo } from "../core/git.js";
import { repoState } from "../core/state.js";
import { t } from "../i18n/index.js";

export const RUN_PREFIX = "bae/";

const runSchema = z.object({
  branch: z.string(),
  from: z.string(),
  base: z.string(),
  startedAt: z.string(),
});

export type Run = z.output<typeof runSchema>;
export type RunCommit = { sha: string; subject: string };

const RUN_FILE = "run.json";
const MAX_COMMITS = 50;

export async function readRun(cwd: string): Promise<Run | undefined> {
  const text = await readTextIfExists(join(repoState(cwd), RUN_FILE));
  try {
    const parsed = runSchema.safeParse(JSON.parse(text ?? ""));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function currentBranch(cwd: string): Promise<string | undefined> {
  return (await git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]))?.trim() || undefined;
}

export async function useRunBranch(ctx: CommandContext, newRun: boolean): Promise<Run | undefined> {
  if (!(await isGitRepo(ctx.cwd))) return undefined;
  const current = await currentBranch(ctx.cwd);
  const recorded = await readRun(ctx.cwd);
  if (!newRun && current?.startsWith(RUN_PREFIX)) {
    if (recorded?.branch === current) return recorded;
    return saveRun(ctx.cwd, {
      branch: current,
      from: current,
      base: (await headCommit(ctx.cwd)) ?? EMPTY_TREE,
      startedAt: new Date().toISOString(),
    });
  }
  if (!newRun && recorded && (await branchExists(ctx.cwd, recorded.branch))) {
    stop(ctx, t("run.elsewhere", { branch: recorded.branch, current: current ?? "HEAD" }));
  }
  return startRun(ctx, current);
}

async function startRun(ctx: CommandContext, current?: string): Promise<Run | undefined> {
  const branch = await freeName(ctx.cwd, `${RUN_PREFIX}${stamp(new Date())}`);
  const base = (await headCommit(ctx.cwd)) ?? EMPTY_TREE;
  const from = current ?? base.slice(0, 12);
  if (!ctx.flags.yes && !(await ctx.prompter.confirm(t("run.confirm", { branch, from }), true))) {
    ctx.prompter.info(t("run.declined", { current: from }));
    return undefined;
  }
  const switched = await gitRun(ctx.cwd, ["switch", "-c", branch]);
  if (switched.exitCode !== 0) {
    stop(ctx, t("run.switchFailed", { branch, details: switched.stderr.trim() }));
  }
  const run = await saveRun(ctx.cwd, { branch, from, base, startedAt: new Date().toISOString() });
  ctx.prompter.info(t("run.started", { branch, from }));
  return run;
}

export async function announcePullRequest(ctx: CommandContext): Promise<void> {
  const run = await readRun(ctx.cwd);
  if (!run || run.branch !== (await currentBranch(ctx.cwd))) return;
  const known = run.from !== run.branch && (await branchExists(ctx.cwd, run.from));
  const command = `gh pr create${known ? ` --base ${run.from}` : ""} --head ${run.branch}`;
  ctx.prompter.note(command, t("run.finished", { branch: run.branch }));
}

export async function requireRunBranch(ctx: CommandContext): Promise<Run | undefined> {
  if (!(await isGitRepo(ctx.cwd))) return undefined;
  const recorded = await readRun(ctx.cwd);
  if (!recorded || !(await branchExists(ctx.cwd, recorded.branch))) return undefined;
  const current = await currentBranch(ctx.cwd);
  if (current === recorded.branch) return recorded;
  stop(ctx, t("run.replanElsewhere", { branch: recorded.branch, current: current ?? "HEAD" }));
}

export async function runCommits(cwd: string, run: Run): Promise<RunCommit[]> {
  const range = run.base === EMPTY_TREE ? run.branch : `${run.base}..${run.branch}`;
  const log = await git(cwd, ["log", `--max-count=${MAX_COMMITS}`, "--format=%h%x00%s", range]);
  return (log ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha = "", subject = ""] = line.split("\0");
      return { sha, subject };
    });
}

async function saveRun(cwd: string, run: Run): Promise<Run> {
  await writeText(join(repoState(cwd), RUN_FILE), `${JSON.stringify(run, null, 2)}\n`);
  return run;
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`])) !== undefined;
}

async function freeName(cwd: string, wanted: string): Promise<string> {
  let name = wanted;
  for (let index = 2; await branchExists(cwd, name); index++) name = `${wanted}-${index}`;
  return name;
}

function stamp(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}`;
}

function stop(ctx: CommandContext, message: string): never {
  ctx.prompter.warn(message);
  ctx.prompter.outro(t("run.stopped"));
  throw new ExitCode(1);
}
