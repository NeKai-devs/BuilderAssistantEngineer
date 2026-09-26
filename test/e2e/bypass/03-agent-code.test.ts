import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agent, bypassRepo, next, REVIEW_PASS, read, statusOf } from "./harness.js";

const RUNNER = `const fs = require("fs");
const files = fs.readdirSync("tests").filter((name) => name.endsWith(".test.js"));
let passed = 0, failed = 0, skipped = 0;
for (const name of files) {
  const text = fs.readFileSync("tests/" + name, "utf8");
  if (/\\.skip\\(/.test(text)) skipped++;
  else if (text.includes("BROKEN")) failed++;
  else passed++;
}
const parts = [failed && failed + " failed", passed + " passed", skipped && skipped + " skipped"].filter(Boolean);
console.log("      Tests  " + parts.join(" | ") + " (" + files.length + ")");
process.exit(failed ? 1 : 0);
`;

const TEST_CMD = "node run-tests.js";

async function suiteRepo() {
  return bypassRepo({
    files: {
      "run-tests.js": RUNNER,
      "package.json": JSON.stringify({ scripts: { test: TEST_CMD } }, null, 2),
      "vitest.config.ts": "export default { test: {} };\n",
      "tests/a.test.js": "it('a', () => expect(1).toBe(1));\n",
      "tests/b.test.js": "it('b', () => expect(2).toBe(2));\n",
    },
    config: { commands: { test: TEST_CMD } },
  });
}

describe("bypass 03: the checks run code the agent cannot quietly change", () => {
  it("restores a test script that was rewritten to always pass", async () => {
    const cwd = await suiteRepo();
    const cheat = agent(cwd, {
      "src/feature.ts": "x\n",
      "tests/b.test.js": "BROKEN\n",
      "package.json": JSON.stringify({ scripts: { test: "exit 0" } }, null, 2),
    });
    const run = await next(cwd, ["--yes"], [cheat]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      "package.json: Changed scripts.test, which the checks run. Restored.",
    );
    expect(await read(cwd, "package.json")).toContain(TEST_CMD);
  });

  it("restores a runner file and a runner config the agent edited", async () => {
    const cwd = await suiteRepo();
    const cheat = agent(cwd, {
      "src/feature.ts": "x\n",
      "run-tests.js": 'console.log("      Tests  2 passed (2)");\n',
      "vitest.config.ts": "export default { test: { exclude: ['**'] } };\n",
    });
    const run = await next(cwd, ["--yes"], [cheat]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("run-tests.js: Changed the test runner configuration. Restored.");
    expect(run.log).toContain("vitest.config.ts: Changed the test runner configuration. Restored.");
    expect(await read(cwd, "run-tests.js")).toBe(RUNNER);
  });

  it("blocks deleting a failing test, even though the suite turns green", async () => {
    const cwd = await suiteRepo();
    const cheat = agent(cwd, { "src/feature.ts": "x\n" }, () =>
      rm(join(cwd, "tests", "b.test.js")),
    );
    const run = await next(cwd, ["--yes"], [cheat, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      "`node run-tests.js` runs fewer tests than before the task (1 run, 0 skipped; before: 2 run, 0 skipped).",
    );
    expect(await statusOf(cwd)).toBe("in_progress");
  });

  it("blocks skipping a test", async () => {
    const cwd = await suiteRepo();
    const cheat = agent(cwd, {
      "src/feature.ts": "x\n",
      "tests/b.test.js": "it.skip('b', () => expect(2).toBe(2));\n",
    });
    const run = await next(cwd, ["--yes"], [cheat, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("`node run-tests.js` skips more tests than before the task");
  });

  it("does not count a deleted test as the tests a tests: required task needs", async () => {
    const cwd = await bypassRepo({
      task: { tests: "required" },
      files: { "tests/a.test.js": "it('a', () => expect(1).toBe(1));\n" },
    });
    const cheat = agent(cwd, { "src/feature.ts": "x\n" }, () =>
      rm(join(cwd, "tests", "a.test.js")),
    );
    const run = await next(cwd, ["--yes"], [cheat, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("tests/a.test.js: Deletes a test file.");
    expect(run.log).toContain("The task requires tests (tests: required)");
  });
});
