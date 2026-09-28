import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { commitPaths } from "../../src/next/commit.js";
import { gitCommitAll, tempDir, writeFiles } from "../helpers.js";

const sh = (cwd: string, command: string) => execSync(command, { cwd }).toString().trim();

describe("commitPaths", () => {
  it("commits the paths git can add and skips ignored or unknown ones", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, { ".gitignore": "dist/\n", "kept.md": "old\n" });
    await gitCommitAll(cwd, "base");
    await writeFiles(cwd, { "kept.md": "new\n", "dist/out.js": "built\n", "other.md": "x\n" });
    const result = await commitPaths(
      cwd,
      ["kept.md", "dist/out.js", "gone.md"],
      "bae: T-001 Mixed",
    );
    expect(result.ok).toBe(true);
    expect(sh(cwd, "git show --name-only --format=%s HEAD").split("\n")).toEqual([
      "bae: T-001 Mixed",
      "",
      "kept.md",
    ]);
    expect(sh(cwd, "git status --short")).toBe("?? other.md");
  });

  it.skipIf(process.platform === "win32")(
    "reads each path literally, not as a pattern",
    async () => {
      const cwd = await tempDir();
      await writeFiles(cwd, { "a.md": "a\n" });
      await gitCommitAll(cwd, "base");
      await writeFiles(cwd, { "a.md": "b\n", ":(glob)*.md": "odd\n" });
      expect((await commitPaths(cwd, [":(glob)*.md"], "bae: T-001 Odd")).ok).toBe(true);
      expect(sh(cwd, "git show --name-only --format= HEAD")).toBe(":(glob)*.md");
      expect(sh(cwd, "git status --short")).toBe("M a.md");
    },
  );

  it("reports that nothing was committed when no path can be added", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, { ".gitignore": "dist/\n", "dist/out.js": "built\n" });
    await gitCommitAll(cwd, "base");
    expect(await commitPaths(cwd, ["dist/out.js"], "bae: T-001 Nothing")).toEqual({
      ok: false,
      details: "nothing to commit",
    });
  });
});
