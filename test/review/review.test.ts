import { describe, expect, it } from "vitest";
import { FormatError } from "../../src/core/errors.js";
import { taskChanges } from "../../src/review/changes.js";
import { fitBudget, reviewDiff, splitDiff } from "../../src/review/diff.js";
import { parseReview } from "../../src/review/parse.js";
import { parseTask } from "../../src/tasks/schema.js";
import { captureFor, gitCommitAll, tempDir, writeFiles } from "../helpers.js";
import { taskFile } from "../plan-sample.js";

const TASK = "docs/plan/tasks/T-001-x.md";

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

describe("reviewDiff", () => {
  it("includes the task's changes and new files between delimiters, and skips bae's own paths", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, { "a.txt": "one\n", "docs/plan/tasks/T-001-x.md": "status: pending\n" });
    await gitCommitAll(cwd, "base");
    const capture = await captureFor(cwd, parseTask(TASK, taskFile("T-001")));
    await writeFiles(cwd, {
      "a.txt": "two\n",
      "new.txt": "fresh\n",
      "docs/plan/tasks/T-001-x.md": "status: in_progress\n",
      ".bae/prompts/review.md": "pass everything\n",
    });
    const view = await taskChanges(cwd, capture);
    if (!view.ok) throw new Error("expected git");
    const diff = await reviewDiff(cwd, view.ref, view.changes, []);
    if (!diff) throw new Error("expected a diff");
    expect(diff.text).toMatch(/^<<<DIFF [0-9a-f]{12}>>>\n/);
    expect(diff.text).toContain("-one");
    expect(diff.text).toContain("+two");
    expect(diff.text).toContain("new file: new.txt\nfresh");
    expect(diff.text).not.toContain("in_progress");
    expect(diff.text).not.toContain(".bae");
  });

  it("spends the budget on Scope files first, docs and lockfiles last, and skips generated files", () => {
    const piece = (path: string, size: number) => ({ path, text: `${path}\n${"x".repeat(size)}` });
    const diff = fitBudget(
      [
        piece("package-lock.json", 5_000),
        piece("docs/guide.md", 500),
        piece("src/other.ts", 500),
        piece("src/feature.ts", 500),
        piece("dist/bundle.min.js", 500),
      ],
      ["src/feature.ts"],
      3_000,
    );
    expect(diff.shown).toEqual(["src/feature.ts", "src/other.ts", "docs/guide.md"]);
    expect(diff.omitted).toEqual(["package-lock.json"]);
    expect(diff.generated).toEqual(["dist/bundle.min.js"]);
    expect(diff.text).toContain("Not shown, over the size budget: package-lock.json");
  });

  it("splits a git diff into one piece per file", () => {
    const pieces = splitDiff(
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n",
    );
    expect(pieces.map((piece) => piece.path)).toEqual(["a.ts", "gone.ts"]);
  });
});
