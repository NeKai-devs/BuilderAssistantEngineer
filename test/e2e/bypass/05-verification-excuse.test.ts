import { describe, expect, it } from "vitest";
import { agent, bypassRepo, COUNTED, next, PASS, REVIEW_PASS } from "./harness.js";

describe("bypass 05: a red suite in Verification is not a free pass", () => {
  it("requires the suite to end green in a tests: fix task, even when another check passes", async () => {
    const test = COUNTED("never.txt");
    const cwd = await bypassRepo({
      task: { tests: "fix", command: `${test}\n${PASS}` },
      config: { commands: { test } },
    });
    const run = await next(cwd, ["--yes"], [agent(cwd, { "src/feature.ts": "x\n" }), REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      `\`${test}\` still fails (exit 1), and the task is tests: fix, so the test suite must end green.`,
    );
  });

  it("does not excuse a red suite that got worse because another Verification command passed", async () => {
    const test = COUNTED("worse.txt");
    const cwd = await bypassRepo({
      task: { command: `${test}\n${PASS}` },
      config: { commands: { test } },
    });
    const work = agent(cwd, { "src/feature.ts": "x\n", "worse.txt": "x\n" });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("fails more checks than before the task");
  });
});
