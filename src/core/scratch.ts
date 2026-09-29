import { rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const live = new Set<string>();

export async function scratchDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  live.add(dir);
  return dir;
}

export async function dropScratch(dir: string): Promise<void> {
  live.delete(dir);
  await rm(dir, { recursive: true, force: true });
}

export function dropAllScratch(): void {
  for (const dir of live) rmSync(dir, { recursive: true, force: true });
  live.clear();
}
