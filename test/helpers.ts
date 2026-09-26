import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { onTestFinished, vi } from "vitest";
import type { Config } from "../src/config/schema.js";
import { runCommand } from "../src/core/process.js";
import { type Capture, prepareCapture } from "../src/gates/capture.js";
import { runDir } from "../src/tasks/runs.js";
import type { Task } from "../src/tasks/schema.js";

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

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    version: 1,
    mode: "greenfield",
    backend: "claude",
    targets: ["claude-code"],
    lang: "en",
    digest: { maxChars: 20_000 },
    commands: {},
    gates: { regression: "full" },
    verify: { allow: [] },
    secrets: { allow: [] },
    agent: { timeoutMinutes: 45 },
    ...overrides,
  };
}

export function captureFor(cwd: string, task: Task, config = testConfig()): Promise<Capture> {
  return prepareCapture(cwd, config, task);
}

export function runFile(cwd: string, id: string, name = ""): string {
  return join(runDir(cwd, id), ...name.split("/").filter(Boolean));
}
