import { describe, expect, it } from "vitest";
import { type SuiteResult, unusableBaseline, verdictOf } from "../../src/gates/regression.js";
import { parseFailing } from "../../src/gates/results.js";

const result = (
  exitCode: number,
  counts?: [number, number, number],
  key: SuiteResult["key"] = "test",
): SuiteResult => ({
  key,
  command: "npm test",
  exitCode,
  output: "",
  ...(counts ? { counts: { passed: counts[0], failed: counts[1], skipped: counts[2] } } : {}),
});

const green = { exitCode: 0, counts: { passed: 3, failed: 0, skipped: 0 }, source: "vitest-json" };

describe("verdictOf", () => {
  it("keeps a green command green", () => {
    expect(verdictOf({ ...result(0, [3, 0, 0]), source: "vitest-json" }, green, false)).toBe(
      "passed",
    );
    expect(verdictOf(result(0, [0, 0, 0], "lint"), { exitCode: 0 }, false)).toBe("passed");
    expect(verdictOf(result(0, undefined, "lint"), { exitCode: 0 }, false)).toBe("passed");
    expect(verdictOf(result(1), { exitCode: 0 }, false)).toBe("regression");
  });

  it("never passes a test command whose counts could not be read", () => {
    expect(verdictOf(result(0), green, false)).toBe("unknown");
    expect(verdictOf(result(0), undefined, false)).toBe("unknown");
    expect(verdictOf(result(0), undefined, true)).toBe("unknown");
    expect(verdictOf({ ...result(0, [3, 0, 0]), source: "vitest" }, green, false)).toBe("unknown");
  });

  it("compares a red command by its counts, not by its exit code", () => {
    const before = { exitCode: 1, counts: { passed: 10, failed: 1, skipped: 0 } };
    expect(verdictOf(result(1, [10, 1, 0]), before, false)).toBe("preexisting");
    expect(verdictOf(result(1, [6, 5, 0]), before, false)).toBe("regression");
    expect(verdictOf(result(1, [9, 1, 0]), before, false)).toBe("regression");
    expect(verdictOf(result(1), before, false)).toBe("uncomparable");
  });

  it("fails closed on timeouts, missing baselines and tests: fix", () => {
    expect(verdictOf(result(-1), { exitCode: -1 }, false)).toBe("unfinished");
    expect(verdictOf(result(1), undefined, false)).toBe("noBaseline");
    const red = { exitCode: 1, counts: { passed: 1, failed: 1, skipped: 0 } };
    expect(verdictOf(result(1, [1, 1, 0]), red, true)).toBe("mustPass");
    expect(verdictOf(result(0, [2, 0, 0]), red, true)).toBe("passed");
    expect(
      verdictOf(
        result(1, [0, 3, 0], "lint"),
        { exitCode: 1, counts: { passed: 0, failed: 3, skipped: 0 } },
        true,
      ),
    ).toBe("preexisting");
  });
});

describe("unusableBaseline", () => {
  it("flags commands that did not finish or fail without counts, except the suite a fix task repairs", () => {
    const results = [result(-1), result(1), result(1, [1, 1, 0]), result(0, [1, 0, 0])];
    expect(unusableBaseline(results, false)).toEqual([results[0], results[1]]);
    expect(unusableBaseline([result(1)], true)).toEqual([]);
  });

  it("flags a test command that passes without counts or whose runner is not recognized", () => {
    const quiet = result(0);
    const unknown = { ...result(1), unrecognized: true };
    expect(unusableBaseline([quiet, unknown, result(0, undefined, "lint")], true)).toEqual([
      quiet,
      unknown,
    ]);
  });
});

describe("failing test names", () => {
  it("blocks a new failing test even when the counts stay the same", () => {
    const before = {
      exitCode: 1,
      counts: { passed: 9, failed: 1, skipped: 0 },
      failing: ["test/a.test.ts > old"],
    };
    const same = { ...result(1, [9, 1, 0]), failing: ["test/a.test.ts > old"] };
    const swapped = { ...result(1, [9, 1, 0]), failing: ["test/b.test.ts > new"] };
    expect(verdictOf(same, before, false)).toBe("preexisting");
    expect(verdictOf(swapped, before, false)).toBe("regression");
  });

  it("reads failing names for the runner the command uses", () => {
    const output = " FAIL  test/b.test.ts > users > rejects\n      Tests  1 failed | 9 passed (10)";
    expect(parseFailing(output, ["vitest"])).toEqual(["test/b.test.ts > users > rejects"]);
    expect(
      parseFailing("FAILED tests/test_api.py::test_login - assert 1 == 2", ["pytest"]),
    ).toEqual(["tests/test_api.py::test_login"]);
    expect(parseFailing(output, [])).toEqual(["test/b.test.ts > users > rejects"]);
    expect(parseFailing("ERROR connecting to db", [])).toBeUndefined();
  });
});
