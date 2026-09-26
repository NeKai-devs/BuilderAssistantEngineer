import { git, isGitRepo, lines } from "../core/git.js";
import { redact } from "./redact.js";

export type GitInfo = { branch: string; branches: string[]; commits: string[]; changes: number };

const COMMIT_LIMIT = 10;

export async function readGitInfo(cwd: string): Promise<GitInfo | undefined> {
  if (!(await isGitRepo(cwd))) return undefined;
  const [branch, branches, commits, status] = await Promise.all([
    git(cwd, ["branch", "--show-current"]),
    git(cwd, ["branch", "--format=%(refname:short)"]),
    git(cwd, ["log", "-n", String(COMMIT_LIMIT), "--date=short", "--pretty=format:%h %ad %s"]),
    git(cwd, ["status", "--porcelain"]),
  ]);
  return {
    branch: (branch ?? "").trim(),
    branches: lines(branches),
    commits: lines(commits).map(redact),
    changes: lines(status).length,
  };
}
