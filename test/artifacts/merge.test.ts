import { describe, expect, it } from "vitest";
import { readLessons, withLessons } from "../../src/artifacts/lessons.js";
import { mergeManaged, planChanges } from "../../src/artifacts/merge.js";
import { splitFrontmatter } from "../../src/tasks/frontmatter.js";
import { tempDir, writeFiles } from "../helpers.js";
import { taskFile } from "../plan-sample.js";

describe("mergeManaged", () => {
  it("wraps generated memory in a managed block", () => {
    expect(mergeManaged(undefined, "# Memory\n", "AGENTS.md")).toBe(
      "<!-- bae:begin -->\n# Memory\n<!-- bae:end -->\n",
    );
  });

  it("appends the block after user content and replaces it later without touching the rest", () => {
    const first = mergeManaged("# My notes\n\nKeep me.\n", "v1", "AGENTS.md");
    expect(first).toBe("# My notes\n\nKeep me.\n\n<!-- bae:begin -->\nv1\n<!-- bae:end -->\n");
    const edited = `${first}\n## Added by hand\n`;
    expect(mergeManaged(edited, "v2", "AGENTS.md")).toBe(
      "# My notes\n\nKeep me.\n\n<!-- bae:begin -->\nv2\n<!-- bae:end -->\n\n## Added by hand\n",
    );
  });

  it("keeps the lessons learned in AGENTS.md when the analyst rewrites the block", () => {
    const before = mergeManaged(
      undefined,
      withLessons("v1", ["Rule one.", "Rule two."]),
      "AGENTS.md",
    );
    const after = mergeManaged(before, "v2", "AGENTS.md");
    expect(after).toBe(
      "<!-- bae:begin -->\nv2\n\n## Lessons learned\n\n<!-- bae:lessons -->\n- Rule one.\n- Rule two.\n<!-- bae:lessons:end -->\n<!-- bae:end -->\n",
    );
    expect(readLessons(after)).toEqual(["Rule one.", "Rule two."]);
    expect(mergeManaged(before, "v2", "CLAUDE.md")).not.toContain("Rule one.");
  });

  it("makes sure CLAUDE.md and GEMINI.md import AGENTS.md exactly once", () => {
    expect(mergeManaged(undefined, "Claude rules", "CLAUDE.md")).toContain(
      "@AGENTS.md\n\nClaude rules",
    );
    const userImport = mergeManaged("@AGENTS.md\n", "Gemini rules", "GEMINI.md");
    expect(userImport.match(/@AGENTS\.md/g)).toHaveLength(1);
  });
});

describe("planChanges", () => {
  it("classifies files, keeps done tasks and preserves task status and file name", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, {
      "docs/plan/00-overview.md": "# Same\n",
      "docs/plan/tasks/T-001-old-name.md": taskFile("T-001", { status: "done" }),
      "docs/plan/tasks/T-002-old-slug.md": taskFile("T-002", { status: "in_progress" }),
    });
    const changes = await planChanges(cwd, [
      { path: "AGENTS.md", content: "# New\n" },
      { path: "docs/plan/00-overview.md", content: "# Same\n" },
      {
        path: "docs/plan/tasks/T-001-new-name.md",
        content: taskFile("T-001", { title: "Changed" }),
      },
      {
        path: "docs/plan/tasks/T-002-new-slug.md",
        content: taskFile("T-002", { title: "Renamed" }),
      },
    ]);
    expect(changes.map(({ path, kind }) => [path, kind])).toEqual([
      ["AGENTS.md", "create"],
      ["docs/plan/00-overview.md", "unchanged"],
      ["docs/plan/tasks/T-001-old-name.md", "keep"],
      ["docs/plan/tasks/T-002-old-slug.md", "update"],
    ]);
    const updated = splitFrontmatter(changes[3]?.after ?? "")?.data;
    expect(updated).toMatchObject({ title: "Renamed", status: "in_progress" });
  });
});
