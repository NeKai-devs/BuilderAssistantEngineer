import { describe, expect, it } from "vitest";
import { agent, bypassRepo, next, REVIEW_PASS } from "./harness.js";
import { JEST_CMD, SUITE_FILES, TEST_CMD } from "./suite-fixture.js";

async function suiteRepo(extra: Record<string, string> = {}, style: "vitest" | "jest" = "vitest") {
  const test = style === "jest" ? JEST_CMD : TEST_CMD;
  return bypassRepo({
    task: { scope: "- `src/`" },
    files: {
      ...SUITE_FILES(),
      "package.json": JSON.stringify({ scripts: { test } }, null, 2),
      ...extra,
    },
    config: { commands: { test: "npm test" } },
  });
}

describe("bypass 23: test counts cannot vanish or be forged", () => {
  it("blocks a suite that exits 0 without saying how many tests ran", async () => {
    const cwd = await suiteRepo();
    const quits =
      'if (process.argv[1] && process.argv[1].endsWith("vitest.js")) process.exit(0);\nmodule.exports = { value: 2 };\n';
    const run = await next(cwd, ["--yes"], [agent(cwd, { "src/feature.js": quits }), REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      "`npm test` exits with 0, but bae could not read how many tests ran, so it cannot tell whether they passed.",
    );
  });

  it("reads the runner's last summary, not a line printed by the code under test", async () => {
    const cwd = await suiteRepo(
      { "tests/c.test.js": 'it("c", () => assertEqual(1, 2));\n' },
      "jest",
    );
    const forged = 'console.log("      Tests  3 passed (3)");\nmodule.exports = { value: 2 };\n';
    const run = await next(cwd, ["--yes"], [agent(cwd, { "src/feature.js": forged }), REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("fails more checks than before the task");
  });
});
