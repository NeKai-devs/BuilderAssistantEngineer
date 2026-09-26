import { runCommand } from "./process.js";

const GIT_TIMEOUT_MS = 30_000;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export async function git(cwd: string, args: string[]): Promise<string | undefined> {
  const result = await runCommand("git", args, { cwd, timeoutMs: GIT_TIMEOUT_MS });
  return result.exitCode === 0 ? result.stdout : undefined;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "--is-inside-work-tree"]))?.trim() === "true";
}

export async function headCommit(cwd: string): Promise<string | undefined> {
  return (await git(cwd, ["rev-parse", "--verify", "HEAD"]))?.trim() || undefined;
}

export async function resolveBase(cwd: string, base: string | undefined): Promise<string> {
  const verified = base && (await git(cwd, ["rev-parse", "--verify", `${base}^{commit}`]))?.trim();
  return verified || (await headCommit(cwd)) || EMPTY_TREE;
}

export function lines(text: string | undefined): string[] {
  return (text ?? "").split(/\r?\n/).filter((line) => line.trim() !== "");
}
