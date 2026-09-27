import { describe, expect, it } from "vitest";
import { verdictOf } from "../../../src/gates/regression.js";
import { parseSummary } from "../../../src/gates/results.js";
import { agent, bypassRepo, next, REVIEW_PASS, statusOf } from "./harness.js";

const LINT = `const fs = require("fs");
const bad = fs.readdirSync("src").filter((f) => fs.readFileSync("src/" + f, "utf8").includes("var "));
for (const f of bad) console.log("src/" + f + ":1:1 error Unexpected var (no-var)");
process.exit(bad.length ? 1 : 0);
`;

describe("bypass 38: the regression check reads what ran, and lets untouched failures be", () => {
  it("counts a cargo test binary that stopped before its summary as a failure", () => {
    const output = [
      "running 3 tests",
      "test tests::adds ... ok",
      "test tests::other ... ok",
      "     Running tests/new.rs (target/debug/deps/new-0123456789abcdef)",
      "running 3 tests",
      "test a ... ok",
      "test b ... ok",
      "test c ... ok",
      "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out",
    ].join("\n");
    expect(parseSummary(output, ["cargo"])?.counts.failed).toBe(1);
  });

  it("treats a test unit that stops reporting in a red suite as a regression", () => {
    const before = {
      exitCode: 1,
      counts: { passed: 4, failed: 1, skipped: 0 },
      units: ["A.dll", "B.dll"],
      failing: ["x"],
      source: "dotnet-trx",
    };
    const after = {
      key: "test" as const,
      command: "dotnet test",
      exitCode: 1,
      output: "",
      counts: { passed: 4, failed: 1, skipped: 0 },
      units: ["A.dll"],
      failing: ["x"],
      source: "dotnet-trx",
    };
    expect(verdictOf(after, before, false)).toBe("regression");
  });

  it("reads mocha's own summary, not a count a test printed", () => {
    expect(parseSummary("  2 failing\n  ok\n\n  3 passing (5ms)\n", ["mocha"])?.counts).toEqual({
      passed: 3,
      failed: 0,
      skipped: 0,
    });
  });

  it("lets the first task of a project with no tests yet set up the runner", async () => {
    const placeholder = { scripts: { test: 'echo "Error: no test specified" && exit 1' } };
    const cwd = await bypassRepo({
      task: { scope: "- `package.json`\n- `tests/`" },
      files: { "package.json": JSON.stringify(placeholder) },
      config: { commands: { test: "npm test" } },
    });
    const setup = agent(cwd, {
      "package.json": JSON.stringify({ scripts: { test: "node vitest.js run" } }),
      "tests/a.test.js": 'it("a", () => expect(1).toBe(1));\n',
    });
    const run = await next(cwd, ["--headless", "--yes"], [setup, REVIEW_PASS]);
    expect(run.log).toContain("has no tests to run yet");
    expect(run.code).toBe(0);
    expect(await statusOf(cwd)).toBe("done");
  });

  it("does not block on a lint error the task did not touch, but blocks a new one", async () => {
    const repo = () =>
      bypassRepo({
        task: { scope: "- `src/`" },
        files: { "lint.js": LINT, "src/old.js": "var a = 1;\n" },
        config: { commands: { lint: "node lint.js" } },
      });
    const clean = await repo();
    const ok = await next(
      clean,
      ["--yes"],
      [agent(clean, { "src/feature.ts": "export const f = 1;\n" }), REVIEW_PASS],
    );
    expect(ok.code).toBe(0);
    const dirty = await repo();
    const bad = await next(
      dirty,
      ["--yes"],
      [agent(dirty, { "src/new.js": "var b = 2;\n" }), REVIEW_PASS],
    );
    expect(bad.code).toBe(1);
    expect(bad.log).toContain("Regression:");
  });
});
