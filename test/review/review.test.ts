import { describe, expect, it } from "vitest";
import { FormatError } from "../../src/core/errors.js";
import { taskDiff } from "../../src/review/diff.js";
import { parseReview } from "../../src/review/parse.js";
import { gitCommitAll, tempDir, writeFiles } from "../helpers.js";

describe("parseReview", () => {
  it("reads the verdict and findings", () => {
    const text =
      'Result:\n{"verdict": "fail", "findings": [{"severity": "blocker", "file": "a.ts", "message": "no tests"}]}';
    expect(parseReview(text)).toEqual({
      verdict: "fail",
      findings: [{ severity: "blocker", file: "a.ts", message: "no tests" }],
    });
    expect(parseReview('{"verdict": "pass"}').findings).toEqual([]);
    expect(() => parseReview('{"verdict": "ok"}')).toThrow(FormatError);
  });
});

describe("taskDiff", () => {
  it("returns undefined outside git", async () => {
    expect(await taskDiff(await tempDir(), undefined, [])).toBeUndefined();
  });

  it("includes changes since the base, new files, and skips excluded paths", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, { "a.txt": "one\n", "docs/plan/tasks/T-001-x.md": "status: pending\n" });
    await gitCommitAll(cwd, "base");
    await writeFiles(cwd, {
      "a.txt": "two\n",
      "new.txt": "fresh\n",
      "docs/plan/tasks/T-001-x.md": "status: in_progress\n",
      ".bae/runs/T-001/base": "abc\n",
    });
    const diff = (await taskDiff(cwd, undefined, [".bae", "docs/plan/tasks/T-001-x.md"])) ?? "";
    expect(diff).toContain("-one");
    expect(diff).toContain("+two");
    expect(diff).toContain("new file: new.txt\nfresh");
    expect(diff).not.toContain("in_progress");
    expect(diff).not.toContain(".bae");
  });
});
