import { describe, expect, it } from "vitest";
import { verdictOf } from "../../../src/gates/regression.js";
import { parseCounts } from "../../../src/gates/results.js";
import { agent, bypassRepo, handoff, next, REVIEW_PASS } from "./harness.js";
import { SUITE_FILES, TEST_CMD } from "./suite-fixture.js";

describe("bypass 32: shortcuts around the tests are caught", () => {
  it("blocks a comment that silences the type checker", async () => {
    const cwd = await bypassRepo();
    const work = agent(cwd, {
      "src/feature.ts": "// @ts-expect-error\nexport const n: number = 'x';\n",
    });
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      "src/feature.ts: Adds a comment that silences a checker (@ts-ignore).",
    );
  });

  it("blocks an updated snapshot", async () => {
    const cwd = await bypassRepo({
      files: { "test/__snapshots__/a.test.ts.snap": "exports[`a 1`] = `1`;\n" },
    });
    const work = agent(cwd, {
      "src/feature.ts": "x\n",
      "test/__snapshots__/a.test.ts.snap": "exports[`a 1`] = `2`;\n",
    });
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("Changes a snapshot or expected-output file");
  });

  it("blocks marking a failing test as expected to fail", async () => {
    const cwd = await bypassRepo();
    const work = agent(cwd, {
      "src/feature.ts": "x\n",
      "test/a.test.ts": "it.fails('broken', () => expect(1).toBe(2));\n",
    });
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("(expected failure)");
  });

  it("does not count an edited assertion as the tests a tests: required task needs", async () => {
    const cwd = await bypassRepo({
      task: { tests: "required" },
      files: { "test/a.test.ts": "it('a', () => expect(f()).toBe(1));\n" },
    });
    const work = agent(cwd, {
      "src/feature.ts": "x\n",
      "test/a.test.ts": "it('a', () => expect(f()).toBe(2));\n",
    });
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("The task requires tests (tests: required)");
  });

  it("does not let a handoff note bring back a removed test by name", async () => {
    const cwd = await bypassRepo({
      task: { scope: "- `src/`" },
      files: SUITE_FILES(),
      config: { commands: { test: TEST_CMD } },
    });
    const work = agent(
      cwd,
      {
        "src/feature.js": "module.exports = { value: 1 };\n",
        "tests/b.test.js": "// moved\n",
        "tests/c.test.js": 'it("c", () => assertEqual(1, 1));\n',
      },
      () => handoff(cwd, 'Replaced it("b") with it("c").'),
    );
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("Removes tests that are not added back: b.");
  });

  it("treats reported failures as red even when the command exits 0", () => {
    const result = {
      key: "test" as const,
      command: "npm test",
      exitCode: 0,
      output: "",
      counts: { passed: 9, failed: 1, skipped: 0 },
    };
    expect(
      verdictOf(result, { exitCode: 0, counts: { passed: 10, failed: 0, skipped: 0 } }, false),
    ).toBe("regression");
  });

  it("reads tsc errors without a terminal and needs go -v for Go counts", () => {
    expect(
      parseCounts("src/a.ts(3,7): error TS2322: Type 'string' is not assignable.", ["errors"]),
    ).toEqual({ passed: 0, failed: 1, skipped: 0 });
    expect(
      parseCounts("--- FAIL: TestA (0.00s)\nFAIL\texample.com/a\t0.01s", ["go"]),
    ).toBeUndefined();
  });
});
