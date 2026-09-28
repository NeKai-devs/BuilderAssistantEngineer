import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { markerCounts, testNames } from "../../../src/review/tests.js";
import type { Step } from "../../fakes.js";
import { agent, bypassRepo, next, REVIEW_PASS, statusOf } from "./harness.js";
import { SUITE_FILES, TEST_CMD } from "./suite-fixture.js";

const justified =
  (...files: string[]): Step =>
  () =>
    JSON.stringify({
      verdict: "pass",
      findings: files.map((file) => ({
        severity: "minor",
        file,
        message: "The task asks for it.",
      })),
    });

const suiteRepo = (scope: string, tests: "optional" | "required" = "optional") =>
  bypassRepo({
    task: { scope, tests },
    files: SUITE_FILES(),
    config: { commands: { test: TEST_CMD } },
  });

describe("bypass 36: test integrity tells a refactor from a shortcut", () => {
  it("lets a task replace a placeholder test in a file its Scope lists", async () => {
    const cwd = await suiteRepo("- `src/`\n- `tests/a.test.js`");
    const work = agent(cwd, {
      "tests/a.test.js":
        'it("adds", () => assertEqual(1 + 1, 2));\nit("subtracts", () => assertEqual(2 - 1, 1));\n',
    });
    const run = await next(cwd, ["--yes"], [work, justified("tests/a.test.js")]);
    expect(run.log).toContain("Removes tests that are not added back: a.");
    expect(run.log).toContain("the reviewer must say why this change is correct");
    expect(run.code).toBe(0);
    expect(await statusOf(cwd)).toBe("done");
  });

  it("fails the review when the reviewer passes a scoped test change without saying why", async () => {
    const cwd = await suiteRepo("- `src/`\n- `tests/a.test.js`");
    const work = agent(cwd, { "tests/a.test.js": 'it("adds", () => assertEqual(1 + 1, 2));\n' });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      "without saying why these changes to test files are correct: tests/a.test.js",
    );
  });

  it("blocks emptying a failing test and adding it back hollow under the same name", async () => {
    const cwd = await suiteRepo("- `src/`");
    const hollow = agent(
      cwd,
      {
        "src/feature.js": "module.exports = { value: 2 };\n",
        "tests/c.test.js": 'it("b", () => assertEqual(1, 1));\n',
      },
      () => rm(join(cwd, "tests", "b.test.js")),
    );
    const run = await next(cwd, ["--yes"], [hollow, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("tests/b.test.js: Removes 1 assertion line(s)");
    expect(run.log).toContain("[blocker]");
  });

  it("still blocks removing a test from a file the Scope does not list", async () => {
    const cwd = await suiteRepo("- `src/`");
    const work = agent(cwd, { "tests/a.test.js": 'it("other", () => assertEqual(1, 1));\n' });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("[blocker]");
    expect(run.log).toContain("Removes tests that are not added back: a.");
  });

  it("does not count re-indented markers as new, and asks why assertions moved out of a file", async () => {
    const cwd = await bypassRepo({
      task: { scope: "- `src/`\n- `tests/a.test.js`" },
      files: {
        "tests/a.test.js":
          'it.skip("slow", () => {});\nit("a", () => {\n  expect(1).toBe(1);\n});\n',
      },
    });
    const work = agent(cwd, {
      "tests/a.test.js":
        'describe("group", () => {\n  it.skip("slow", () => {});\n  it("a", () => check(1));\n});\n',
      "tests/helpers.js": "global.check = (n) => expect(n).toBe(1);\n",
    });
    const run = await next(cwd, ["--yes"], [work, justified("tests/a.test.js")]);
    expect(run.log).not.toContain("Adds a marker");
    expect(run.log).toContain("tests/a.test.js: Removes 1 assertion line(s)");
    expect(run.code).toBe(0);
  });

  it("does not meet tests: required by renaming a test file or adding one the runner skips", async () => {
    const renamed = await suiteRepo("- `src/`\n- `tests/`", "required");
    const rename = agent(renamed, { "tests/bee.test.js": SUITE_FILES()["tests/b.test.js"] }, () =>
      rm(join(renamed, "tests", "b.test.js")),
    );
    const first = await next(renamed, ["--yes"], [rename, REVIEW_PASS]);
    expect(first.code).toBe(1);
    expect(first.log).toContain("The task requires tests (tests: required)");
    const hidden = await suiteRepo("- `src/`\n- `tests/`", "required");
    const skipped = agent(hidden, { "tests/doubled.js": 'it("d", () => assertEqual(2, 2));\n' });
    const second = await next(hidden, ["--yes"], [skipped, REVIEW_PASS]);
    expect(second.code).toBe(1);
    expect(second.log).toContain("The task requires tests (tests: required)");
  });

  it("sends a named suppression and a new snapshot to the reviewer instead of blocking", async () => {
    const cwd = await bypassRepo({ task: { scope: "- `src/`" } });
    const work = agent(cwd, {
      "src/feature.ts": "// eslint-disable-next-line no-console\nconsole.log(1);\n",
      "test/__snapshots__/feature.test.ts.snap": "exports[`f 1`] = `1`;\n",
    });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.log).toContain("[major]");
    expect(run.code).toBe(0);
  });

  it("reads markers and test names in their common forms without matching ordinary code", () => {
    expect(
      markerCounts("model.fit(X, y)\nconst o = { skip: true };\n// it.only is banned").size,
    ).toBe(0);
    expect(markerCounts('fit("x", () => {});\ntest("t", { skip: true }, () => {});').size).toBe(2);
    expect(
      testNames(
        "@Test\nvoid addsNumbers() {}\n[Fact]\npublic void Multiplies() {}\n#[test]\nfn divides() {}",
      ),
    ).toEqual(["addsNumbers", "Multiplies", "divides"]);
  });

  it("lets the count of tests go down only when the Scope marks the test file as removed", async () => {
    const planned = await suiteRepo("- `src/`\n- `tests/b.test.js` (delete)");
    const drop = agent(planned, {}, () => rm(join(planned, "tests", "b.test.js")));
    const run = await next(planned, ["--yes"], [drop, justified("tests/b.test.js")]);
    expect(run.log).toContain("marks test files it removes");
    expect(run.code).toBe(0);
    const unplanned = await suiteRepo("- `src/`\n- `tests/b.test.js`");
    const quiet = agent(unplanned, {}, () => rm(join(unplanned, "tests", "b.test.js")));
    const blocked = await next(unplanned, ["--yes"], [quiet, REVIEW_PASS]);
    expect(blocked.code).toBe(1);
    expect(blocked.log).toContain("runs fewer tests than before the task");
  });
});
