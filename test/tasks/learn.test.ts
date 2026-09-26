import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FormatError } from "../../src/core/errors.js";
import { addLesson, parseLesson } from "../../src/tasks/learn.js";
import { tempDir, writeFiles } from "../helpers.js";

describe("parseLesson", () => {
  it("keeps one line of rule without a bullet", () => {
    expect(
      parseLesson(
        'Here: {"root_cause": " Missing tests. ", "rule": "- Test   every route.\\nMore."}',
      ),
    ).toEqual({ rootCause: "Missing tests.", rule: "Test every route." });
    expect(() => parseLesson('{"root_cause": "x"}')).toThrow(FormatError);
  });
});

describe("addLesson", () => {
  it("appends to the managed block, keeps user text and skips duplicates", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, {
      "AGENTS.md": "# Mine\n\n<!-- bae:begin -->\n# Project\n<!-- bae:end -->\n\nFooter.\n",
    });
    await addLesson(cwd, "Rule one.");
    await addLesson(cwd, "Rule two.");
    await addLesson(cwd, "Rule one.");
    expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe(
      "# Mine\n\n<!-- bae:begin -->\n# Project\n\n## Lessons learned\n\n<!-- bae:lessons -->\n- Rule one.\n- Rule two.\n<!-- bae:lessons:end -->\n<!-- bae:end -->\n\nFooter.\n",
    );
  });
});
