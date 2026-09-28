import type { Dirent } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { repoState } from "../core/state.js";

export type StateGuard = { verify(): Promise<string[]> };

const GUARDED = new Set(["capture.json", "attempts.jsonl", "lesson.md", "active.json"]);

export async function guardState(cwd: string): Promise<StateGuard> {
  const root = repoState(cwd);
  const before = await readGuarded(root);
  return {
    async verify() {
      const after = await readGuarded(root);
      const changed: string[] = [];
      for (const [path, content] of before) {
        const now = after.get(path);
        if (now?.equals(content)) continue;
        changed.push(relative(root, path).split("\\").join("/"));
        await writeFile(path, content);
      }
      for (const path of after.keys()) {
        if (before.has(path)) continue;
        changed.push(relative(root, path).split("\\").join("/"));
        await rm(path, { force: true });
      }
      return changed.sort();
    },
  };
}

async function readGuarded(root: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const path of await walk(root)) {
    const name = path.split(/[\\/]/).at(-1) ?? "";
    if (!GUARDED.has(name)) continue;
    const content = await readFile(path).catch(() => undefined);
    if (content) files.set(path, content);
  }
  return files;
}

async function walk(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return Promise.resolve(entry.isFile() ? [path] : []);
    }),
  );
  return nested.flat();
}
