import { describe, expect, it } from "vitest";
import { parseTask, taskProblems } from "../../../src/tasks/schema.js";
import { taskFile } from "../../plan-sample.js";
import { agent, bypassRepo, next, REVIEW_PASS, statusOf, TASK } from "./harness.js";

const EXIT = (code: number) => `node -e "process.exit(${code})"`;

describe("bypass 12: Verification runs as one strict bash script", () => {
  it("fails when a piped command fails, instead of taking the last command's exit code", async () => {
    const cwd = await bypassRepo({ task: { command: `${EXIT(1)} | cat` } });
    const run = await next(cwd, ["--yes"], [agent(cwd, { "src/feature.ts": "x\n" })]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("Verification failed:");
    expect(await statusOf(cwd)).toBe("in_progress");
  });

  it("runs continued lines and keeps cd across lines", async () => {
    const script = `cd sub\n${EXIT(0)} \\\n  && node check.js`;
    const cwd = await bypassRepo({
      task: { command: script },
      files: { "sub/check.js": "process.exit(0);\n" },
    });
    const run = await next(cwd, ["--yes"], [agent(cwd, { "src/feature.ts": "x\n" }), REVIEW_PASS]);
    expect(run.code).toBe(0);
  });

  it.each([
    ["npm test || true", "hides failures"],
    ["echo ok", "runs nothing that checks the task"],
    ["ls dist", "runs nothing that checks the task"],
  ])("blocks `%s` before launching the agent", async (command, reason) => {
    const cwd = await bypassRepo({ task: { command } });
    const run = await next(cwd, ["--yes"], []);
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(0);
    expect(run.log).toContain(reason);
    expect(await statusOf(cwd)).toBe("blocked");
  });

  it("makes the analyst fix a trivial Verification before the plan is written", () => {
    const task = parseTask(TASK, taskFile("T-001", { command: "echo done" }));
    expect(taskProblems(task).join("\n")).toContain(
      "Verification runs nothing that checks the task",
    );
  });
});
