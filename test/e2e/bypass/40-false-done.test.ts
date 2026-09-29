import { describe, expect, it } from "vitest";
import type { ProcessRunner } from "../../../src/backends/agent-cli.js";
import { createBackend } from "../../../src/backends/index.js";
import type { Backend } from "../../../src/backends/types.js";
import { main } from "../../../src/cli.js";
import { EnvironmentError } from "../../../src/core/errors.js";
import { git } from "../../../src/core/git.js";
import type { CommandResult } from "../../../src/core/process.js";
import { recordTrust } from "../../../src/next/trust.js";
import { fakePrompter } from "../../fakes.js";
import {
  agent,
  attempts,
  bypassRepo,
  next,
  PASS,
  REVIEW_PASS,
  read,
  statusOf,
  stops,
} from "./harness.js";

const LOGGED_OUT: CommandResult = {
  exitCode: 1,
  stdout: "",
  stderr: "Invalid API key · Please run /login",
  notFound: false,
};

function exits(result: CommandResult): ProcessRunner {
  return { run: async () => result, interactive: async () => result };
}

async function nextWith(cwd: string, args: string[], backend: (name: string) => Backend) {
  await recordTrust(cwd);
  const ui = fakePrompter([]);
  const printed: string[] = [];
  const code = await main(["node", "bae", "next", ...args], cwd, {
    prompter: ui.prompter,
    createBackend: (name) => backend(name),
    env: {},
    print: (text) => printed.push(text),
  });
  return { code, log: ui.log.join("\n") };
}

async function branch(cwd: string): Promise<string> {
  return (await git(cwd, ["branch", "--show-current"]))?.trim() ?? "";
}

async function commits(cwd: string): Promise<number> {
  return Number((await git(cwd, ["rev-list", "--count", "HEAD"]))?.trim());
}

describe("bypass 40: an agent that did not work never reaches done (audit A2, A3, A18)", () => {
  it("does not run the checks after an interactive session that exits with an error, even when they already pass", async () => {
    const cwd = await bypassRepo({ task: { command: PASS } });
    const before = await commits(cwd);
    const run = await nextWith(cwd, ["--yes"], (name) =>
      createBackend(name as "claude", { runner: exits(LOGGED_OUT) }),
    );
    expect(run.code).toBe(1);
    expect(run.log).toContain("`claude` exited with code 1 before the task was finished");
    expect(run.log).not.toContain("Verification passed");
    expect(run.log).not.toContain("is done");
    expect(await statusOf(cwd)).toBe("in_progress");
    expect(await commits(cwd)).toBe(before);
    expect(await attempts(cwd)).toEqual([]);
    expect(await stops(cwd)).toMatchObject([{ stage: "agent" }]);
  });

  it("stops a headless run whose agent CLI is logged out, without an attempt, a retry or a lesson", async () => {
    const cwd = await bypassRepo({ task: { command: PASS } });
    let runs = 0;
    const runner: ProcessRunner = {
      run: async () => {
        runs++;
        return LOGGED_OUT;
      },
      interactive: async () => LOGGED_OUT,
    };
    const run = await nextWith(cwd, ["--headless", "--yes"], (name) =>
      createBackend(name as "claude", { runner }),
    );
    expect(run.code).toBe(1);
    expect(runs).toBe(1);
    expect(run.log).toContain("Invalid API key");
    expect(await statusOf(cwd)).toBe("in_progress");
    expect(await attempts(cwd)).toEqual([]);
    expect(await read(cwd, "AGENTS.md")).toBe("# Rules\n");
  });

  it("stops after one agent run when the reviewer cannot be reached, keeping the agent's work", async () => {
    const cwd = await bypassRepo();
    const offline = () => {
      throw new EnvironmentError("API Error: Connection error");
    };
    const run = await next(
      cwd,
      ["--headless", "--yes"],
      [agent(cwd, { "src/feature.ts": "export const x = 1;\n" }), offline],
    );
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(2);
    expect(run.log).toContain("Connection error");
    expect(await statusOf(cwd)).toBe("in_progress");
    expect(await read(cwd, "src/feature.ts")).toBe("export const x = 1;\n");
    expect(await attempts(cwd)).toEqual([]);
    expect(await stops(cwd)).toMatchObject([{ stage: "review" }]);
    expect(await read(cwd, "AGENTS.md")).toBe("# Rules\n");
  });

  it("finds a missing agent CLI before creating a branch or running the project's commands", async () => {
    const marker = "baseline-ran.txt";
    const cwd = await bypassRepo({
      config: { commands: { lint: `node -e "require('fs').writeFileSync('${marker}', '')"` } },
    });
    const missing: Backend = {
      name: "claude",
      available: async () => false,
      run: async () => "",
    };
    const run = await nextWith(cwd, ["--headless", "--yes"], () => missing);
    expect(run.code).toBe(1);
    expect(run.log).toContain("`claude` is not installed or not in PATH");
    expect(run.log).toContain("Nothing was run.");
    expect(await branch(cwd)).toBe("main");
    await expect(read(cwd, marker)).rejects.toThrow();
    expect(await statusOf(cwd)).toBe("pending");
    expect(await attempts(cwd)).toEqual([]);
  });

  it("leaves the user on their branch when the task is refused before the agent", async () => {
    const cwd = await bypassRepo({ task: { command: "sudo make check" } });
    const run = await next(cwd, ["--headless", "--yes"], []);
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(0);
    expect(await branch(cwd)).toBe("main");
    expect(await attempts(cwd)).toEqual([]);
    expect(run.log).toContain("it does not count as an attempt");
  });

  it("creates the run branch only once the baseline is recorded and the agent is about to start", async () => {
    const cwd = await bypassRepo({ config: { commands: { lint: 'node -e "process.exit(3)"' } } });
    const stopped = await next(cwd, ["--headless", "--yes"], []);
    expect(stopped.code).toBe(1);
    expect(stopped.calls).toHaveLength(0);
    expect(stopped.log).toContain("gives no usable baseline");
    expect(await branch(cwd)).toBe("main");
    const ok = await bypassRepo();
    const work = agent(ok, { "src/feature.ts": "x\n" });
    const started = await next(ok, ["--headless", "--yes"], [work, REVIEW_PASS]);
    expect(started.code).toBe(0);
    expect(await branch(ok)).toMatch(/^bae\//);
  });

  it("shows only real attempts in status after refusals and environment stops", async () => {
    const cwd = await bypassRepo({ task: { command: "sudo make check" } });
    await next(cwd, ["--headless", "--yes"], []);
    const printed: string[] = [];
    await main(["node", "bae", "status"], cwd, { print: (text) => printed.push(text) });
    const status = printed.join("");
    expect(status).toContain("T-001 is blocked: ");
    expect(status).not.toContain("attempts:");
    expect(status).not.toContain("done on the first attempt");
  });
});
