import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureGitignore } from "../../src/core/gitignore.js";
import { tempDir, writeFiles } from "../helpers.js";

describe("ensureGitignore", () => {
  it("creates or extends .gitignore once, keeping existing lines", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, { ".gitignore": "node_modules/\n.bae/tmp/" });
    expect(await ensureGitignore(cwd)).toEqual([".bae/runs/"]);
    expect(await ensureGitignore(cwd)).toEqual([]);
    expect(await readFile(join(cwd, ".gitignore"), "utf8")).toBe(
      "node_modules/\n.bae/tmp/\n.bae/runs/\n",
    );
  });
});
