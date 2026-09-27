import { describe, expect, it } from "vitest";
import { agent, attempts, bypassRepo, next, REVIEW_PASS, statusOf } from "./harness.js";
import { SUITE_FILES, TEST_CMD } from "./suite-fixture.js";

const OWN_SCRIPT = "node scripts/run-tests.js";
const OWN_FILES = {
  "scripts/run-tests.js":
    'require("child_process").execFileSync("node", ["vitest.js", "run"], { stdio: "inherit" });\n',
};

const suiteRepo = (test: string, extra: Record<string, string> = {}) =>
  bypassRepo({
    task: { scope: "- `src/`" },
    files: { ...SUITE_FILES(), ...extra },
    config: { commands: { test } },
  });

describe("bypass 33: a test verdict comes from the runner's own report, or it is unknown", () => {
  it("stops before the agent when it does not recognize the test runner", async () => {
    const cwd = await suiteRepo(OWN_SCRIPT, OWN_FILES);
    const run = await next(cwd, ["--yes"], []);
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(0);
    expect(run.log).toContain(
      `bae does not recognize the test runner behind \`${OWN_SCRIPT}\`, so it cannot tell whether the tests pass.`,
    );
    expect(await statusOf(cwd)).toBe("pending");
  });

  it("records the skip and leaves the command out when --allow-skip overrides it", async () => {
    const cwd = await suiteRepo(OWN_SCRIPT, OWN_FILES);
    const work = agent(cwd, { "src/feature.js": "module.exports = { value: 1, more: 2 };\n" });
    const run = await next(cwd, ["--yes", "--allow-skip"], [work, REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect((await attempts(cwd))[0].skips[0]).toContain(
      `bae does not recognize the test runner behind \`${OWN_SCRIPT}\``,
    );
  });

  it("does not trust a summary printed after the report went missing", async () => {
    const cwd = await suiteRepo(TEST_CMD);
    const forged =
      'console.log("      Tests  2 passed (2)");\nprocess.exit(0);\nmodule.exports = { value: 2 };\n';
    const run = await next(cwd, ["--yes"], [agent(cwd, { "src/feature.js": forged }), REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      `\`${TEST_CMD}\` exits with 0, but bae could not read how many tests ran`,
    );
    expect(await statusOf(cwd)).toBe("in_progress");
  });

  it("reads the runner's report through an npm script", async () => {
    const cwd = await suiteRepo("npm test", {
      "package.json": JSON.stringify({ scripts: { test: TEST_CMD } }, null, 2),
    });
    const work = agent(cwd, { "src/feature.js": "module.exports = { value: 1, more: 2 };\n" });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(run.printed).toContain("      Tests  2 passed (2)");
  });
});
