import { runCommand } from "../core/process.js";
import { redact } from "./redact.js";

export type GitInfo = { branch: string; branches: string[]; commits: string[]; changes: number };

const COMMIT_LIMIT = 10;

export async function readGitInfo(cwd: string): Promise<GitInfo | undefined> {
  if ((await git(cwd, ["rev-parse", "--is-inside-work-tree"])).trim() !== "true") return undefined;
  const [branch, branches, commits, status] = await Promise.all([
    git(cwd, ["branch", "--show-current"]),
    git(cwd, ["branch", "--format=%(refname:short)"]),
    git(cwd, ["log", "-n", String(COMMIT_LIMIT), "--date=short", "--pretty=format:%h %ad %s"]),
    git(cwd, ["status", "--porcelain"]),
  ]);
  return {
    branch: branch.trim(),
    branches: lines(branches),
    commits: lines(commits).map(redact),
    changes: lines(status).length,
  };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runCommand("git", args, { cwd, timeoutMs: 10_000 });
  return result.exitCode === 0 ? result.stdout : "";
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "");
}
