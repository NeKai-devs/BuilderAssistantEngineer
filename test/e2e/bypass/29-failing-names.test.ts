import { describe, expect, it } from "vitest";
import { agent, bypassRepo, next, REVIEW_PASS } from "./harness.js";

const RUNNER = `const fs = require("fs");
const a = require("./src/a.js").value === 1;
const b = require("./src/b.js").value === 1;
let failed = 0;
if (!a) { failed++; console.log(" FAIL  tests/a.test.ts > a works"); }
if (!b) { failed++; console.log(" FAIL  tests/b.test.ts > b works"); }
console.log("      Tests  " + (failed ? failed + " failed | " : "") + (3 - failed) + " passed (3)");
process.exit(failed ? 1 : 0);
`;

describe("bypass 29: with a red suite, a different failing test is a regression", () => {
  it("blocks fixing one failing test and breaking another", async () => {
    const cwd = await bypassRepo({
      task: { scope: "- `src/`" },
      files: {
        "vitest-runner.js": RUNNER,
        "src/a.js": "module.exports = { value: 0 };\n",
        "src/b.js": "module.exports = { value: 1 };\n",
      },
      config: { commands: { test: "node vitest-runner.js" } },
    });
    const swap = agent(cwd, {
      "src/a.js": "module.exports = { value: 1 };\n",
      "src/b.js": "module.exports = { value: 0 };\n",
    });
    const run = await next(cwd, ["--yes"], [swap, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("Regression:");
  });
});
