import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { writeConfig, writeInterview } from "../../src/config/store.js";
import { runCommand } from "../../src/core/process.js";
import { repoState } from "../../src/core/state.js";
import { markActive, prepareCapture, saveCapture } from "../../src/gates/capture.js";
import { parseTask } from "../../src/tasks/schema.js";
import { fakePrompter, type Step, scriptedBackend, trusting } from "../fakes.js";
import { tempDir, testConfig, writeFiles } from "../helpers.js";
import { planOutput } from "../plan-sample.js";
import { bypassRepo, next, read, TASK } from "./bypass/harness.js";

async function run(cwd: string, args: string[], steps: Step[] = [], answers: unknown[] = []) {
  const ui = fakePrompter(answers);
  const ai = scriptedBackend(steps);
  const code = await main(["node", "bae", ...args], cwd, {
    prompter: trusting(ui.prompter),
    createBackend: () => ai.backend,
    env: {},
    print: () => {},
  });
  return { code, log: ui.log.join("\n"), calls: ai.calls };
}

describe("safe repository state (audit A11)", () => {
  it("refuses to start while another bae command runs in the repository", async () => {
    const cwd = await bypassRepo();
    const lock = join(repoState(cwd), "lock.json");
    await mkdir(repoState(cwd), { recursive: true });
    await writeFile(lock, JSON.stringify({ pid: process.pid, command: "plan" }));
    const busy = await run(cwd, ["next", "--yes"]);
    expect(busy.code).toBe(1);
    expect(busy.calls).toHaveLength(0);
    expect(JSON.parse(await readFile(lock, "utf8")).pid).toBe(process.pid);
  });

  it("takes over a lock left by a process that is gone", async () => {
    const cwd = await bypassRepo();
    await mkdir(repoState(cwd), { recursive: true });
    await writeFile(
      join(repoState(cwd), "lock.json"),
      JSON.stringify({ pid: 2 ** 30, command: "next" }),
    );
    const resumed = await run(cwd, ["next", "--yes", "--dry-run"]);
    expect(resumed.code).toBe(0);
    await expect(readFile(join(repoState(cwd), "lock.json"), "utf8")).rejects.toThrow();
  });

  it("finds the repository's setup when run from a subdirectory", async () => {
    const cwd = await bypassRepo({ files: { "src/app.ts": "export {};\n" } });
    const inside = await run(join(cwd, "src"), ["next", "--yes", "--dry-run"]);
    expect(inside.code).toBe(0);
    expect(inside.log).toContain("T-001 · Do T-001");
    await expect(read(cwd, "src/.bae/config.json")).rejects.toThrow();
  });

  it("stops before anything runs in a repository with no commits", async () => {
    const cwd = await bypassRepo({ git: false });
    await runCommand("git", ["init", "-q"], { cwd });
    const empty = await next(cwd, ["--yes"], []);
    expect(empty.code).toBe(1);
    expect(empty.calls).toHaveLength(0);
    expect(empty.log).toContain("This repository has no commits yet");
  });

  it("warns in init about a folder without git, below the root, or with an unreadable config", async () => {
    const plain = await tempDir();
    const noGit = await run(plain, ["init", "--yes"]);
    expect(noGit.log).toContain("This folder is not a git repository.");
    const repo = await tempDir();
    await runCommand("git", ["init", "-q"], { cwd: repo });
    await writeFiles(repo, { "pkg/.bae/config.json": "{ not json" });
    const below = await run(join(repo, "pkg"), ["init", "--yes"]);
    expect(below.code).toBe(0);
    expect(below.log).toContain("not at the repository root");
    expect(below.log).toContain("cannot be read, so setup starts from the defaults");
  });

  it("warns about misspelled settings", async () => {
    const cwd = await bypassRepo();
    const config = JSON.parse(await read(cwd, ".bae/config.json"));
    config.gates.regresion = "off";
    config.verify.alow = ["make"];
    await writeFiles(cwd, { ".bae/config.json": JSON.stringify(config) });
    const typo = await run(cwd, ["next", "--yes", "--dry-run"]);
    expect(typo.log).toContain("gates.regresion, verify.alow");
  });

  it("says so when a run was interrupted before its checks", async () => {
    const cwd = await bypassRepo();
    const task = parseTask(TASK, await read(cwd, TASK));
    await saveCapture(cwd, await prepareCapture(cwd, testConfig(), task));
    await markActive(cwd, "T-001");
    const resumed = await run(cwd, ["next", "--yes", "--dry-run"]);
    expect(resumed.log).toContain("The previous run of T-001 stopped before its checks finished");
  });

  it("gives the analyst a time limit", async () => {
    const cwd = await tempDir();
    await writeConfig(cwd, {
      version: 1,
      mode: "greenfield",
      backend: "claude",
      targets: ["claude-code"],
      lang: "en",
    });
    await writeInterview(cwd, "# Interview\n\nA tool.\n");
    const planned = await run(cwd, ["plan", "--yes"], [() => planOutput()]);
    expect(planned.code).toBe(0);
    expect(planned.calls[0]?.options.timeoutMs).toBe(60 * 60_000);
  });
});
