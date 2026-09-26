import { describe, expect, it } from "vitest";
import { renderTree, TREE_ENTRIES_PER_DIR } from "../../src/digest/tree.js";

describe("renderTree", () => {
  it("lists directories first and collapses them at the depth limit", () => {
    const paths = [
      "README.md",
      "src/index.ts",
      "src/lib/a.ts",
      "src/lib/deep/b.ts",
      "test/a.test.ts",
    ];
    expect(renderTree(paths, 2)).toBe(
      ["src/", "  lib/ (2 files)", "  index.ts", "test/", "  a.test.ts", "README.md"].join("\n"),
    );
  });

  it("caps entries per directory", () => {
    const paths = Array.from(
      { length: TREE_ENTRIES_PER_DIR + 5 },
      (_, i) => `f${String(i).padStart(2, "0")}.ts`,
    );
    const lines = renderTree(paths, 3).split("\n");
    expect(lines).toHaveLength(TREE_ENTRIES_PER_DIR + 1);
    expect(lines.at(-1)).toBe("… 5 more");
  });
});
