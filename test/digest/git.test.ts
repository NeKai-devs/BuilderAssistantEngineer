import { describe, expect, it } from "vitest";
import { writeConfig, writeInterview } from "../../src/config/store.js";
import { ensureGitignore } from "../../src/core/gitignore.js";
import { runCommand } from "../../src/core/process.js";
import { readGitInfo } from "../../src/digest/git.js";
import { gitCommitAll, tempDir, testConfig, writeFiles } from "../helpers.js";

async function git(cwd: string, ...args: string[]) {
  const result = await runCommand(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr);
}

describe("readGitInfo", () => {
  it("returns undefined outside a repository", async () => {
    expect(await readGitInfo(await tempDir())).toBeUndefined();
  });

  it("summarizes branch, commits and uncommitted changes", async () => {
    const root = await tempDir();
    await git(root, "init", "-q", "-b", "main");
    await writeFiles(root, { "a.txt": "1" });
    await git(root, "add", "-A");
    await git(root, "commit", "-q", "-m", "feat: first commit");
    await writeFiles(root, { "b.txt": "2" });
    const info = await readGitInfo(root);
    expect(info?.branch).toBe("main");
    expect(info?.branches).toEqual(["main"]);
    expect(info?.commits).toHaveLength(1);
    expect(info?.commits[0]).toMatch(/^[0-9a-f]+ \d{4}-\d{2}-\d{2} feat: first commit$/);
    expect(info?.changes).toBe(1);
  });

  it("does not count bae's own setup as uncommitted work", async () => {
    const root = await tempDir();
    await writeFiles(root, { "src/app.ts": "export const app = 1;\n", ".gitignore": "dist/\n" });
    await gitCommitAll(root, "chore: initial state");
    await ensureGitignore(root);
    await writeConfig(root, testConfig());
    await writeInterview(root, "# Interview\n");
    expect((await readGitInfo(root))?.changes).toBe(0);
    await writeFiles(root, { ".gitignore": "dist/\n.bae/tmp/\ncoverage/\n", "notes.md": "x" });
    expect((await readGitInfo(root))?.changes).toBe(2);
  });
});
