import { describe, expect, it } from "vitest";
import { agent, bypassRepo, next, REVIEW_PASS } from "./harness.js";
import { BROKEN_FEATURE, SUITE_FILES, TEST_CMD } from "./suite-fixture.js";

const suiteRepo = () =>
  bypassRepo({
    task: { scope: "- `src/`" },
    files: SUITE_FILES(),
    config: { commands: { test: TEST_CMD } },
  });

describe("bypass 24: a failing test cannot be swapped for an easy one", () => {
  it("blocks removing a test and adding a trivial one to keep the count", async () => {
    const cwd = await suiteRepo();
    const swap = agent(cwd, {
      "src/feature.js": BROKEN_FEATURE,
      "tests/b.test.js": "// b moved\n",
      "tests/c.test.js": 'it("c", () => assertEqual(2, 2));\n',
    });
    const run = await next(cwd, ["--yes"], [swap, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("tests/b.test.js: Removes tests that are not added back: b.");
  });

  it("blocks neutralizing the assertion helper the tests use", async () => {
    const cwd = await suiteRepo();
    const neuter = agent(cwd, {
      "src/feature.js": BROKEN_FEATURE,
      "tests/setup.js": "global.assertEqual = () => {};\n",
    });
    const run = await next(cwd, ["--yes"], [neuter, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("tests/setup.js: Removes 1 assertion line(s) from a test file");
  });
});
