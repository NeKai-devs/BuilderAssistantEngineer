import { describe, expect, it } from "vitest";
import { skipMarkers } from "../../../src/review/tests.js";
import { trivialityProblems } from "../../../src/tasks/checks.js";

describe("bypass 26: masking and skip markers are recognized in their other forms", () => {
  it.each([["npm test || node -v"], ["set +eu"], ["npm test &"], ["trap - ERR"]])(
    "refuses `%s` as hiding failures",
    (line) => {
      expect(trivialityProblems([line]).map((problem) => problem.reason)).toContain("masks");
    },
  );

  it.each([
    ["if npm test; then echo ok; fi"],
    ["npm test || exit 1"],
    ["npm test 2>&1 | tee test.log"],
  ])("accepts `%s`", (line) => {
    expect(trivialityProblems([line])).toEqual([]);
  });

  it.each([
    ['it.skipIf(true)("b", () => {});'],
    ['test.concurrent.skip("b", () => {});'],
    ['describe.skipIf(process.env.CI)("s", () => {});'],
    ['it.todo("b");'],
    ["pytestmark = pytest.mark.skip(reason='later')"],
    ["//go:build ignore"],
  ])("flags `%s` in a test file", (text) => {
    expect(skipMarkers({ path: "test/a.test.ts", text })).not.toEqual([]);
  });
});
