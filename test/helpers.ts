import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished, vi } from "vitest";

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bae-test-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export function captureOutput() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  return { out: () => out.join(""), err: () => err.join("") };
}
