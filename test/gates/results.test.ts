import { describe, expect, it } from "vitest";
import { parseCounts, runnerHint } from "../../src/gates/results.js";

describe("parseCounts", () => {
  it.each([
    [
      "vitest",
      " Test Files  1 failed | 3 passed (4)\n      Tests  2 failed | 40 passed | 3 skipped (45)",
      [40, 2, 3],
    ],
    ["jest", "Tests:       1 failed, 2 skipped, 7 passed, 10 total", [7, 1, 2]],
    ["pytest", "===== 3 failed, 12 passed, 2 skipped, 1 error in 1.23s =====", [12, 4, 2]],
    [
      "cargo",
      "test result: ok. 5 passed; 0 failed; 1 ignored; 0 measured\ntest result: FAILED. 2 passed; 1 failed; 0 ignored;",
      [7, 1, 1],
    ],
    [
      "go -v",
      "=== RUN   TestA\n--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.00s)\n--- SKIP: TestC (0.00s)",
      [1, 1, 1],
    ],
    ["mocha", "  12 passing (30ms)\n  1 pending\n  2 failing", [12, 2, 1]],
    ["node:test", "# tests 5\n# pass 4\n# fail 1\n# skipped 0\n# todo 0", [4, 1, 0]],
    ["bun", " 9 pass\n 1 skip\n 0 fail\n", [9, 0, 1]],
    ["deno", "FAILED | 4 passed | 1 failed | 2 ignored (30ms)", [4, 1, 2]],
    ["unittest", "Ran 6 tests in 0.010s\n\nFAILED (failures=1, errors=1, skipped=1)", [3, 2, 1]],
    ["rspec", "10 examples, 2 failures, 1 pending", [7, 2, 1]],
    ["minitest", "8 runs, 20 assertions, 1 failures, 0 errors, 2 skips", [5, 1, 2]],
    ["phpunit ok", "OK (9 tests, 30 assertions)", [9, 0, 0]],
    ["phpunit", "Tests: 9, Assertions: 30, Failures: 2, Skipped: 1.", [6, 2, 1]],
    ["dotnet", "Failed!  - Failed:     1, Passed:    10, Skipped:     2, Total:    13", [10, 1, 2]],
    ["maven", "Tests run: 12, Failures: 1, Errors: 1, Skipped: 2", [8, 2, 2]],
    ["eslint", "✖ 5 problems (3 errors, 2 warnings)", [0, 3, 0]],
    ["tsc", "Found 4 errors in 2 files.", [0, 4, 0]],
  ])("reads %s output", (_, output, [passed, failed, skipped]) => {
    expect(parseCounts(output)).toEqual({ passed, failed, skipped });
  });

  it("takes the last summary, and only the runner the command uses", () => {
    const forged =
      "      Tests  3 passed (3)\nreal output\nTests:       1 failed, 2 passed, 3 total";
    expect(parseCounts(forged)).toEqual({ passed: 2, failed: 1, skipped: 0 });
    const early = "Tests:       1 failed, 2 passed, 3 total\n      Tests  3 passed (3)";
    expect(parseCounts(early, runnerHint("npx jest --ci"))).toEqual({
      passed: 2,
      failed: 1,
      skipped: 0,
    });
    expect(parseCounts("      Tests  3 passed (3)", runnerHint("npx jest"))).toBeUndefined();
  });

  it("does not count Go packages as tests", () => {
    expect(parseCounts("ok  \texample.com/a\t0.012s\nFAIL\texample.com/b\t0.020s")).toBeUndefined();
  });

  it("ignores color codes and returns nothing for output without a summary", () => {
    expect(parseCounts("\u001b[32m      Tests  3 passed (3)\u001b[39m")).toEqual({
      passed: 3,
      failed: 0,
      skipped: 0,
    });
    expect(parseCounts("something broke\n")).toBeUndefined();
  });
});
