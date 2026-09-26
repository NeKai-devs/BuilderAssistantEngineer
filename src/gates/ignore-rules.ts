import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import ignore, { type Ignore } from "ignore";
import { readTextIfExists } from "../core/fs.js";
import { git, gitPaths } from "../core/git.js";

export type IgnoreSource = { dir: string; text: string };
export type IgnoreMatcher = (path: string, isDir: boolean) => boolean;

type Layer = { dir: string; matcher: Ignore };

const IGNORE_CASE = process.platform !== "linux";

export async function captureIgnore(cwd: string): Promise<IgnoreSource[]> {
  const globalFile = await globalExcludes(cwd);
  const infoFile = (await git(cwd, ["rev-parse", "--git-path", "info/exclude"]))?.trim();
  const listed =
    (await gitPaths(cwd, [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ":(glob)**/.gitignore",
    ])) ?? [];
  const perDirectory = await Promise.all(
    [...new Set(listed)].map(async (path) => ({
      dir: path.split("/").slice(0, -1).join("/"),
      text: (await readTextIfExists(join(cwd, ...path.split("/")))) ?? "",
    })),
  );
  const shared = await Promise.all(
    [globalFile, infoFile && (isAbsolute(infoFile) ? infoFile : join(cwd, infoFile))].map(
      async (path) => ({ dir: "", text: (path && (await readTextIfExists(path))) || "" }),
    ),
  );
  return [...shared, ...perDirectory.sort((a, b) => depth(a.dir) - depth(b.dir))].filter(
    (source) => source.text.trim() !== "",
  );
}

export function ignoreMatcher(sources: IgnoreSource[]): IgnoreMatcher {
  const layers: Layer[] = sources.map((source) => ({
    dir: source.dir,
    matcher: ignore({ allowRelativePaths: true, ignorecase: IGNORE_CASE }).add(source.text),
  }));
  const decide = (path: string, isDir: boolean): boolean => {
    let ignored = false;
    for (const layer of layers) {
      if (layer.dir && !path.startsWith(`${layer.dir}/`)) continue;
      const relative = layer.dir ? path.slice(layer.dir.length + 1) : path;
      const result = layer.matcher.test(isDir ? `${relative}/` : relative);
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }
    return ignored;
  };
  return (path, isDir) => {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) {
      if (decide(parts.slice(0, index).join("/"), true)) return true;
    }
    return decide(path, isDir);
  };
}

export async function untrackedFiles(
  cwd: string,
  isIgnored: IgnoreMatcher,
): Promise<string[] | undefined> {
  const entries = await gitPaths(cwd, ["ls-files", "--others", "--directory", "--", "."]);
  if (!entries) return undefined;
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith("/")) {
      if (!isIgnored(entry, false)) found.push(entry);
      continue;
    }
    const dir = entry.slice(0, -1);
    if (!isIgnored(dir, true)) found.push(...(await walk(cwd, dir, isIgnored)));
  }
  return found.sort();
}

async function walk(cwd: string, dir: string, isIgnored: IgnoreMatcher): Promise<string[]> {
  const entries = await listDir(join(cwd, ...dir.split("/")));
  if (entries.some((entry) => entry.name === ".git")) return [];
  const found: string[] = [];
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!isIgnored(path, true)) found.push(...(await walk(cwd, path, isIgnored)));
    } else if (entry.isFile() && !isIgnored(path, false)) {
      found.push(path);
    }
  }
  return found;
}

async function globalExcludes(cwd: string): Promise<string> {
  const configured = (await git(cwd, ["config", "--path", "--get", "core.excludesFile"]))?.trim();
  if (configured) return configured;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "git", "ignore");
}

async function listDir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function depth(dir: string): number {
  return dir === "" ? 0 : dir.split("/").length;
}
