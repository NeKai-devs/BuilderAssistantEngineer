import { describe, expect, it } from "vitest";
import { loadBrief } from "../../src/interview/brief.js";
import { tempDir, writeFiles } from "../helpers.js";

describe("loadBrief", () => {
  it("loads comma-separated files as sections", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, { "docs/brief.md": "Build a CLI.\n", "notes.txt": "For teams." });
    expect(await loadBrief(cwd, "docs/brief.md, notes.txt")).toEqual({
      text: "### docs/brief.md\n\nBuild a CLI.\n\n### notes.txt\n\nFor teams.",
      files: ["docs/brief.md", "notes.txt"],
    });
  });

  it("treats anything that is not all files as plain text", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, { "a.md": "x" });
    expect(await loadBrief(cwd, "a.md, a habit tracker")).toEqual({
      text: "a.md, a habit tracker",
      files: [],
    });
    expect(await loadBrief(cwd, "   ")).toEqual({ text: "", files: [] });
  });
});
