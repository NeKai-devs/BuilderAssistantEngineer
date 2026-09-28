import { type CommandResult, runCommand } from "./process.js";

const GIT_TIMEOUT_MS = 30_000;
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const HARDENED = [
  "--no-replace-objects",
  "-c",
  "core.quotePath=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "diff.relative=false",
  "-c",
  "diff.external=",
  "-c",
  "color.ui=never",
];

export const DIFF_FLAGS = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--text",
  "--no-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

export async function git(cwd: string, args: string[]): Promise<string | undefined> {
  const result = await runCommand("git", [...HARDENED, ...args], {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  return result.exitCode === 0 ? result.stdout : undefined;
}

export async function gitRun(
  cwd: string,
  args: string[],
  input?: string,
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<CommandResult> {
  return runCommand("git", [...HARDENED, ...args], {
    cwd,
    timeoutMs,
    ...(input === undefined ? {} : { input }),
  });
}

export async function gitPaths(cwd: string, args: string[]): Promise<string[] | undefined> {
  const out = await git(cwd, [...args.slice(0, 1), "-z", ...args.slice(1)]);
  return out === undefined ? undefined : out.split("\0").filter((path) => path !== "");
}

export async function flaggedFiles(cwd: string): Promise<string[] | undefined> {
  const entries = await gitPaths(cwd, ["ls-files", "-v"]);
  return entries
    ?.filter((entry) => /^[a-zS] /.test(entry))
    .map((entry) => entry.slice(2))
    .sort();
}

export function unquotePath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const bytes: number[] = [];
  const body = raw.slice(1, -1);
  const escapes: Record<string, number> = {
    n: 10,
    t: 9,
    r: 13,
    '"': 34,
    "\\": 92,
    a: 7,
    b: 8,
    f: 12,
    v: 11,
  };
  for (let index = 0; index < body.length; index++) {
    const char = body[index] ?? "";
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const next = body[index + 1] ?? "";
    if (/[0-7]/.test(next)) {
      bytes.push(Number.parseInt(body.slice(index + 1, index + 4), 8));
      index += 3;
      continue;
    }
    bytes.push(escapes[next] ?? next.charCodeAt(0));
    index += 1;
  }
  return Buffer.from(bytes).toString("utf8");
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "--is-inside-work-tree"]))?.trim() === "true";
}

export async function headCommit(cwd: string): Promise<string | undefined> {
  return (await git(cwd, ["rev-parse", "--verify", "HEAD"]))?.trim() || undefined;
}

export async function verifyCommit(cwd: string, ref: string): Promise<string | undefined> {
  return (
    (await git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]))?.trim() || undefined
  );
}

export async function resolveBase(cwd: string, base: string | undefined): Promise<string> {
  const verified = base && (await verifyCommit(cwd, base));
  return verified || (await headCommit(cwd)) || EMPTY_TREE;
}

export function lines(text: string | undefined): string[] {
  return (text ?? "").split(/\r?\n/).filter((line) => line.trim() !== "");
}

export function literal(path: string): string {
  return `:(literal)${path}`;
}

export function excluded(path: string): string {
  return `:(exclude,literal)${path}`;
}
