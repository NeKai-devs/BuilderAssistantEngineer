import { describe, expect, it } from "vitest";
import { agent, bypassRepo, COUNTED, FAIL, next, REVIEW_PASS, statusOf } from "./harness.js";

describe("bypass 04: a suite that was already red still catches new failures", () => {
  it("blocks when the task makes more tests fail, even though the exit code is the same", async () => {
    const test = COUNTED("worse.txt");
    const cwd = await bypassRepo({ config: { commands: { test } } });
    const work = agent(cwd, { "src/feature.ts": "export const f = 1;\n", "worse.txt": "x\n" });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      `Regression: \`${test}\` fails more checks than before the task (5 passed, 5 failed, 0 skipped; before: 9 passed, 1 failed, 0 skipped).`,
    );
    expect(await statusOf(cwd)).toBe("in_progress");
  });

  it("passes when the red suite did not get worse", async () => {
    const test = COUNTED("worse.txt");
    const cwd = await bypassRepo({ config: { commands: { test } } });
    const work = agent(cwd, { "src/feature.ts": "export const f = 1;\n" });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(0);
  });

  it("stops before the agent when a red command has no counts to compare", async () => {
    const cwd = await bypassRepo({ config: { commands: { test: FAIL } } });
    const run = await next(cwd, ["--yes"], []);
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(0);
    expect(run.log).toContain(`\`${FAIL}\` gives no usable baseline (exit 1)`);
    expect(await statusOf(cwd)).toBe("pending");
  });
});
