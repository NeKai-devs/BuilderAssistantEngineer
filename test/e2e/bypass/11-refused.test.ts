import { describe, expect, it } from "vitest";
import { runFile, writeFiles } from "../../helpers.js";
import { taskFile } from "../../plan-sample.js";
import { attempts, bypassRepo, FAIL, next, PASS, statusOf } from "./harness.js";

describe("bypass 11: a task that can never pass does not hold the plan hostage", () => {
  it("blocks a task whose checks are refused before launching the agent, then moves on", async () => {
    const cwd = await bypassRepo({
      task: { command: "sudo make check" },
      files: { "docs/plan/tasks/T-002-second.md": taskFile("T-002", { command: PASS }) },
    });
    const refused = await next(cwd, ["--yes"], []);
    expect(refused.code).toBe(1);
    expect(refused.calls).toHaveLength(0);
    expect(await statusOf(cwd)).toBe("blocked");
    expect((await attempts(cwd))[0]).toMatchObject({ outcome: "blocked", stage: "refused" });
    const following = await next(cwd, ["--yes", "--dry-run"], []);
    expect(following.log).toContain("T-002 · Do T-002");
    const printed: string[] = [];
    const { main } = await import("../../../src/cli.js");
    await main(["node", "bae", "status"], cwd, { print: (text) => printed.push(text) });
    expect(printed.join("")).toContain(
      "T-001 is blocked: Refusing to run `sudo make check` (sudo). Fix the task's Verification section.",
    );
  });

  it("puts an in-progress task that used its attempts behind the ready ones", async () => {
    const cwd = await bypassRepo({
      task: { command: FAIL, status: "in_progress" },
      files: { "docs/plan/tasks/T-002-second.md": taskFile("T-002", { command: PASS }) },
    });
    const failed = JSON.stringify({
      startedAt: new Date().toISOString(),
      durationMs: 1,
      headless: false,
      outcome: "failed",
      regressions: [],
    });
    await writeFiles(runFile(cwd, "T-001"), {
      "attempts.jsonl": `${failed}\n${failed}\n${failed}\n`,
    });
    const run = await next(cwd, ["--yes", "--dry-run"], []);
    expect(run.log).toContain("T-002 · Do T-002");
  });
});
