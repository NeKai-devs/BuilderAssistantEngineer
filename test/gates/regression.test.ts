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

describe("verdictOf", () => {
  it("keeps a green command green", () => {
    expect(verdictOf(result(0), { exitCode: 0 }, false)).toBe("passed");
    expect(verdictOf(result(1), { exitCode: 0 }, false)).toBe("regression");
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
    expect(verdictOf(result(0), red, true)).toBe("passed");
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
    const results = [result(-1), result(1), result(1, [1, 1, 0]), result(0)];
    expect(unusableBaseline(results, false)).toEqual([results[0], results[1]]);
    expect(unusableBaseline([result(1)], true)).toEqual([]);
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
