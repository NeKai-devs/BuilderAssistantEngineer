import { join } from "node:path";
import { readTextIfExists } from "../core/fs.js";
import { git, isGitRepo, lines, resolveBase } from "../core/git.js";
import { truncateText } from "../digest/format.js";

const MAX_DIFF_CHARS = 60_000;
const MAX_NEW_FILES = 20;
const MAX_NEW_FILE_CHARS = 4_000;

export async function taskDiff(
  cwd: string,
  base: string | undefined,
  exclude: string[],
): Promise<string | undefined> {
  if (!(await isGitRepo(cwd))) return undefined;
  const pathspec = ["--", ".", ...exclude.map((path) => `:(exclude)${path}`)];
  const ref = await resolveBase(cwd, base);
  const diff = (await git(cwd, ["diff", ref, ...pathspec])) ?? "";
  const untracked = lines(
    await git(cwd, ["ls-files", "--others", "--exclude-standard", ...pathspec]),
  );
  const added = await Promise.all(
    untracked.slice(0, MAX_NEW_FILES).map((path) => newFile(cwd, path)),
  );
  return truncateText([diff.trim(), ...added].filter(Boolean).join("\n\n"), MAX_DIFF_CHARS);
}

async function newFile(cwd: string, path: string): Promise<string> {
  const text = (await readTextIfExists(join(cwd, ...path.split("/")))) ?? "";
  return `new file: ${path}\n${truncateText(text, MAX_NEW_FILE_CHARS)}`;
}
