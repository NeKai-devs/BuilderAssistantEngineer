import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { markerCounts, testNames } from "../../../src/review/tests.js";
import { agent, bypassRepo, next, REVIEW_PASS, statusOf } from "./harness.js";
import { SUITE_FILES, TEST_CMD } from "./suite-fixture.js";

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
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.log).toContain("Removes tests that are not added back: a.");
    expect(run.log).toContain("so the reviewer judges it instead");
    expect(run.code).toBe(0);
    expect(await statusOf(cwd)).toBe("done");
  });

  it("still blocks removing a test from a file the Scope does not list", async () => {
    const cwd = await suiteRepo("- `src/`");
    const work = agent(cwd, { "tests/a.test.js": 'it("other", () => assertEqual(1, 1));\n' });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("[blocker]");
    expect(run.log).toContain("Removes tests that are not added back: a.");
  });

  it("does not count moved assertions or re-indented markers as losses or new markers", async () => {
    const cwd = await bypassRepo({
      task: { scope: "- `src/`" },
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
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.log).not.toContain("Adds a marker");
    expect(run.log).not.toContain("assertion line");
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
});
