import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import ignore, { type Ignore } from "ignore";
import { readTextIfExists } from "../core/fs.js";

export type FileEntry = { path: string; size: number };
export type Scan = { files: FileEntry[]; truncated: boolean };

type Rule = { base: string; matcher: Ignore };

export const MAX_FILES = 50_000;

const SKIPPED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".bae",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".gradle",
  ".idea",
  ".terraform",
  "coverage",
]);

export async function scanFiles(root: string, maxFiles = MAX_FILES): Promise<Scan> {
  const scan: Scan = { files: [], truncated: false };
  const rules = await loadRules(root, "", [".gitignore", ".baeignore"]);
  await walk(root, "", rules, scan, maxFiles);
  return scan;
}

async function walk(
  root: string,
  dir: string,
  inherited: Rule[],
  scan: Scan,
  maxFiles: number,
): Promise<void> {
  const rules = dir ? [...inherited, ...(await loadRules(root, dir, [".gitignore"]))] : inherited;
  for (const entry of await listDir(join(root, dir))) {
    if (scan.files.length >= maxFiles) {
      scan.truncated = true;
      return;
    }
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && !isIgnored(path, true, rules)) {
        await walk(root, path, rules, scan, maxFiles);
      }
    } else if (entry.isFile() && !isIgnored(path, false, rules)) {
      scan.files.push({ path, size: (await stat(join(root, path))).size });
    }
  }
}

async function listDir(path: string): Promise<Dirent[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

async function loadRules(root: string, dir: string, names: string[]): Promise<Rule[]> {
  const texts = await Promise.all(names.map((name) => readTextIfExists(join(root, dir, name))));
  const patterns = texts.filter((text): text is string => text !== undefined);
  return patterns.length > 0 ? [{ base: dir, matcher: ignore().add(patterns.join("\n")) }] : [];
}

function isIgnored(path: string, isDir: boolean, rules: Rule[]): boolean {
  return rules.some(({ base, matcher }) => {
    const relative = base ? path.slice(base.length + 1) : path;
    return matcher.ignores(isDir ? `${relative}/` : relative);
  });
}
