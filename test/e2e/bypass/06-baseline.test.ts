import { describe, expect, it } from "vitest";
import { vitest } from "../../fake-vitest.js";
import { writeFiles } from "../../helpers.js";
import { taskFile } from "../../plan-sample.js";
import {
  agent,
  attempts,
  BREAKS_WITH,
  bypassRepo,
  next,
  PASS,
  REVIEW_PASS,
  statusOf,
  TASK,
} from "./harness.js";

describe("bypass 06: the baseline cannot be declined, taken late or partial", () => {
  it("stops when the baseline is declined, and records the skip when --allow-skip overrides it", async () => {
    const cwd = await bypassRepo({ config: { commands: { test: vitest() } } });
    const declined = await next(cwd, [], [], [true, false]);
    expect(declined.code).toBe(1);
    expect(declined.calls).toHaveLength(0);
    expect(await statusOf(cwd)).toBe("pending");
    const work = agent(cwd, { "src/feature.ts": "x\n" });
    const skipped = await next(cwd, ["--allow-skip"], [work, REVIEW_PASS], [false, true]);
    expect(skipped.code).toBe(0);
    expect((await attempts(cwd))[0].skips).toEqual([
      "Without running lint and tests first there is no baseline, so the task could not be done.",
    ]);
  });

  it("never takes a baseline after the agent already worked on the task", async () => {
    const cwd = await bypassRepo({ config: { commands: { test: PASS } } });
    await writeFiles(cwd, { [TASK]: taskFile("T-001", { status: "in_progress", command: PASS }) });
    const run = await next(cwd, ["--yes"], []);
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(0);
    expect(run.log).toContain("T-001 is in progress without a capture from before its agent ran");
  });

  it("checks typecheck and build as well as lint and test", async () => {
    const typecheck = BREAKS_WITH("types.txt");
    const build = BREAKS_WITH("build.txt");
    const cwd = await bypassRepo({ config: { commands: { typecheck, build } } });
    const work = agent(cwd, { "src/feature.ts": "x\n", "types.txt": "x\n", "build.txt": "x\n" });
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(`Regression: \`${typecheck}\` exits with 1 after the task.`);
    expect(run.log).toContain(`Regression: \`${build}\` exits with 1 after the task.`);
  });
});
