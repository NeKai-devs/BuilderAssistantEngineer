import { describe, expect, it } from "vitest";
import { scanFiles } from "../../src/digest/walk.js";
import { tempDir, writeFiles } from "../helpers.js";

describe("scanFiles", () => {
  it("honors root and nested .gitignore, .baeignore and built-in skips", async () => {
    const root = await tempDir();
    await writeFiles(root, {
      ".gitignore": "dist/\n*.log\n",
      ".baeignore": "private/\n",
      "a.ts": "export {}",
      "debug.log": "x",
      "dist/out.js": "x",
      "private/notes.md": "x",
      "pkg/.gitignore": "*.gen.ts\n",
      "pkg/b.ts": "x",
      "pkg/c.gen.ts": "x",
      "node_modules/lib/index.js": "x",
      ".git/HEAD": "ref",
      ".bae/config.json": "{}",
      "docs/x.md": "# x",
    });
    const { files, truncated } = await scanFiles(root);
    expect(truncated).toBe(false);
    expect(files.map((file) => file.path)).toEqual([
      ".baeignore",
      ".gitignore",
      "a.ts",
      "docs/x.md",
      "pkg/.gitignore",
      "pkg/b.ts",
    ]);
    expect(files.find((file) => file.path === "a.ts")?.size).toBe(9);
  });

  it("stops at the file limit and reports truncation", async () => {
    const root = await tempDir();
    await writeFiles(root, { "a.txt": "1", "b.txt": "2", "c.txt": "3" });
    const scan = await scanFiles(root, 2);
    expect(scan.files).toHaveLength(2);
    expect(scan.truncated).toBe(true);
  });
});
