import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { onTestFinished, vi } from "vitest";
import { runCommand } from "../src/core/process.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/repos/", import.meta.url));

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bae-test-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export async function copyFixture(name: string): Promise<string> {
  const dir = await tempDir();
  await cp(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

export async function writeFiles(root: string, files: Record<string, string | Buffer>) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
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

export async function gitCommitAll(cwd: string, message: string): Promise<void> {
  const identity = [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
  ];
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["add", "-A"],
    [...identity, "commit", "-q", "--allow-empty", "-m", message],
  ]) {
    const result = await runCommand("git", args, { cwd });
    if (result.exitCode !== 0) throw new Error(result.stderr);
  }
}
