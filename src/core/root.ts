import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function projectRoot(cwd: string): Promise<string> {
  let dir = cwd;
  for (;;) {
    if (await exists(join(dir, ".bae", "config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir || (await exists(join(dir, ".git")))) return cwd;
    dir = parent;
  }
}

export async function gitTop(cwd: string): Promise<string | undefined> {
  let dir = cwd;
  for (;;) {
    if (await exists(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}
