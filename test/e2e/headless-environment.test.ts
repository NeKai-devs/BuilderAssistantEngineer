import { describe, expect, it } from "vitest";
import { writeConfig } from "../../src/config/store.js";
import { vitest } from "../fake-vitest.js";
import type { Step } from "../fakes.js";
import { gitCommitAll, tempDir, writeFiles } from "../helpers.js";
import { taskFile } from "../plan-sample.js";
import {
  agent,
  attempts,
  bypassRepo,
  FAIL,
  handoff,
  next,
  PASS,
  REVIEW_PASS,
  read,
  statusOf,
  stops,
  TASK,
} from "./bypass/harness.js";

const HEADLESS = ["--headless", "--yes"];

const deniedWork =
  (cwd: string, denied: string[]): Step =>
  async (_prompt, options) => {
    options.onInfo?.({ denied });
    await writeFiles(cwd, { "src/feature.ts": "export const f = 1;\n" });
    await handoff(cwd);
    return "";
  };

async function greenfield(command: string, lint: string): Promise<string> {
  const cwd = await tempDir();
  await writeFiles(cwd, {
    "AGENTS.md": "# Rules\n",
    ".claude/agents/reviewer.md":
      "---\nname: reviewer\ndescription: Strict\n---\nReject shortcuts.",
    [TASK]: taskFile("T-001", { command, scope: "- `src/feature.ts`" }),
  });
  await writeConfig(cwd, {
    version: 1,
    mode: "greenfield",
    backend: "claude",
    targets: ["claude-code"],
    lang: "en",
    commands: { lint },
    gates: { regression: "full" },
    verify: { allow: ["node -e"] },
  });
  await gitCommitAll(cwd, "plan");
  return cwd;
}

describe("next --headless and the agent's environment", () => {
  it("lets the agent run the project's checks and install dependencies", async () => {
    const cwd = await bypassRepo({ config: { commands: { test: vitest() } } });
    const run = await next(cwd, HEADLESS, [agent(cwd, { "src/feature.ts": "x\n" }), REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(run.calls[0]?.options.allow).toContain("node vitest.js run");
    expect(run.calls[0]?.prompt).toContain(
      "This run is unattended, so nobody can approve a command.",
    );
    expect(run.calls[0]?.prompt).toContain("`node vitest.js run`");
    expect(run.calls[0]?.prompt).toContain("`git status`");
  });

  it("repeats the allowed commands in the retry prompt, and leaves them out of an interactive one", async () => {
    const needsOk = `node -e "process.exit(require('fs').existsSync('src/ok.ts') ? 0 : 1)"`;
    const cwd = await bypassRepo({ task: { command: needsOk, scope: "- `src/`" } });
    const retried = await next(cwd, HEADLESS, [
      agent(cwd, { "src/feature.ts": "x\n" }),
      agent(cwd, { "src/ok.ts": "export const ok = true;\n" }),
      REVIEW_PASS,
    ]);
    expect(retried.calls[1]?.prompt).toContain("The previous attempt did not pass");
    expect(retried.calls[1]?.prompt).toContain("This run is unattended");
    const interactive = await bypassRepo();
    const run = await next(
      interactive,
      ["--yes"],
      [agent(interactive, { "src/feature.ts": "x\n" }), REVIEW_PASS],
    );
    expect(run.calls[0]?.prompt).not.toContain("This run is unattended");
  });

  it("stops at once, naming the command, when the agent was denied a command it needed, without counting an attempt", async () => {
    const cwd = await bypassRepo({ task: { command: FAIL } });
    const run = await next(cwd, HEADLESS, [deniedWork(cwd, ["npm --version", "npx biome init"])]);
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(1);
    expect(await statusOf(cwd)).toBe("in_progress");
    expect(run.log).toContain(
      "claude was not allowed to run `npx biome init`, so another attempt would fail the same way.",
    );
    expect(run.log).toContain("a rule such as `Bash(npx biome *)`");
    expect(run.log).toContain("does not count as one of its attempts");
    expect(await attempts(cwd)).toEqual([]);
    expect(await stops(cwd)).toMatchObject([{ stage: "verification" }]);
  });

  it("names the missing program first when the agent was also denied an install", async () => {
    const cwd = await bypassRepo({ task: { command: 'node -e "process.exit(127)"' } });
    const install = `npm install --save-dev ${"left-pad ".repeat(20)}; echo "exit:$?"`;
    const run = await next(cwd, HEADLESS, [deniedWork(cwd, [install, "npm --version"])]);
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(1);
    expect(run.log).toContain("could not find a program it runs (exit 127)");
    expect(run.log).toContain(
      "claude was also not allowed to run `npm install --save-dev left-pad",
    );
    expect(run.log).toContain("…`.");
    expect(run.log).not.toContain("`npm --version`");
  });

  it("stops at once when a check cannot find its program, without a lesson or an attempt", async () => {
    const cwd = await bypassRepo({ task: { command: 'node -e "process.exit(127)"' } });
    const run = await next(cwd, HEADLESS, [agent(cwd, { "src/feature.ts": "x\n" })]);
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(1);
    expect(await statusOf(cwd)).toBe("in_progress");
    expect(run.log).toContain("could not find a program it runs (exit 127)");
    expect(run.log).toContain("does not count as one of its attempts");
    expect(await attempts(cwd)).toEqual([]);
    expect(await read(cwd, "AGENTS.md")).toBe("# Rules\n");
  });

  it("retries when the agent was only denied lookups that cannot affect the checks", async () => {
    const needsOk = `node -e "process.exit(require('fs').existsSync('src/ok.ts') ? 0 : 1)"`;
    const cwd = await bypassRepo({ task: { command: needsOk, scope: "- `src/`" } });
    const run = await next(cwd, HEADLESS, [
      deniedWork(cwd, ["npm --version", "git ls-remote https://github.com/x/y"]),
      agent(cwd, { "src/ok.ts": "export const ok = true;\n" }),
      REVIEW_PASS,
    ]);
    expect(run.code).toBe(0);
    expect(await statusOf(cwd)).toBe("done");
    expect(run.log).not.toContain("was not allowed to run");
  });

  it("records no baseline before the first task of a repository with no toolchain", async () => {
    const cwd = await greenfield(PASS, PASS);
    const run = await next(cwd, HEADLESS, [agent(cwd, { "src/feature.ts": "x\n" }), REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(run.log).toContain("No toolchain yet: the repository has no code or project manifest");
    expect(run.log).not.toContain("Regression baseline");
    expect(run.log).not.toContain("already fails before the task");
  });

  it("still requires the checks to pass after that first task", async () => {
    const cwd = await greenfield(PASS, 'node -e "process.exit(127)"');
    const run = await next(cwd, HEADLESS, [agent(cwd, { "src/feature.ts": "x\n" })]);
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(1);
    expect(await statusOf(cwd)).toBe("in_progress");
    expect(run.log).toContain("could not find a program it runs (exit 127)");
  });
});
