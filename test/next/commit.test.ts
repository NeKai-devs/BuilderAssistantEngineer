import { execSync } from "node:child_process";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitPaths, taskMessage } from "../../src/next/commit.js";
import { parseTask } from "../../src/tasks/schema.js";
import { gitCommitAll, tempDir, writeFiles } from "../helpers.js";
import { taskFile } from "../plan-sample.js";

const sh = (cwd: string, command: string) => execSync(command, { cwd }).toString().trim();
const HOOKS = { verify: true };
const meta = (title: string, type?: string) =>
  parseTask("docs/plan/tasks/T-007-x.md", taskFile("T-007", { title, type })).meta;

describe("taskMessage", () => {
  it("writes a conventional commit header with the task id and a Bae-Task trailer", () => {
    expect(taskMessage(meta("Add the login page.", "feat"))).toEqual([
      "feat: add the login page (T-007)",
      "Bae-Task: T-007",
    ]);
  });

  it("defaults to chore and lowercases only a first letter followed by a lowercase one", () => {
    expect(taskMessage(meta("API keys rotate daily"))[0]).toBe(
      "chore: API keys rotate daily (T-007)",
    );
    expect(taskMessage(meta("GET /health returns ok", "fix"))[0]).toBe(
      "fix: GET /health returns ok (T-007)",
    );
    expect(taskMessage(meta("OAuth callback", "feat"))[0]).toBe("feat: OAuth callback (T-007)");
    expect(taskMessage(meta("wire the OAuth callback", "feat"))[0]).toBe(
      "feat: wire the OAuth callback (T-007)",
    );
  });

  it("lowercases a first letter with an accent or a tilde, as in Spanish titles", () => {
    expect(taskMessage(meta("Añade el módulo hello", "feat"))[0]).toBe(
      "feat: añade el módulo hello (T-007)",
    );
    expect(taskMessage(meta("Ámbito de los equipos", "docs"))[0]).toBe(
      "docs: ámbito de los equipos (T-007)",
    );
    expect(taskMessage(meta("A\u0301mbito compuesto", "docs"))[0]).toBe(
      "docs: ámbito compuesto (T-007)",
    );
    expect(taskMessage(meta("ÑANDÚ API", "docs"))[0]).toBe("docs: ÑANDÚ API (T-007)");
  });

  it("shortens a long title so the header fits in 100 characters", () => {
    const header = taskMessage(meta(`Refactor ${"the store ".repeat(20)}`, "refactor"))[0] ?? "";
    expect(header).toHaveLength(100);
    expect(header).toMatch(/^refactor: refactor the store .*… \(T-007\)$/);
  });
});

describe("commitPaths", () => {
  it("commits the paths git can add and skips ignored or unknown ones", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, { ".gitignore": "dist/\n", "kept.md": "old\n" });
    await gitCommitAll(cwd, "base");
    await writeFiles(cwd, { "kept.md": "new\n", "dist/out.js": "built\n", "other.md": "x\n" });
    const paths = ["kept.md", "dist/out.js", "gone.md"];
    const result = await commitPaths(
      cwd,
      paths,
      ["chore: mixed (T-001)", "Bae-Task: T-001"],
      HOOKS,
    );
    expect(result.ok).toBe(true);
    expect(sh(cwd, "git show --name-only --format=%s HEAD").split("\n")).toEqual([
      "chore: mixed (T-001)",
      "",
      "kept.md",
    ]);
    expect(sh(cwd, "git log -1 --format=%b")).toBe("Bae-Task: T-001");
    expect(sh(cwd, "git status --short")).toBe("?? other.md");
  });

  it.skipIf(process.platform === "win32")(
    "reads each path literally, not as a pattern",
    async () => {
      const cwd = await tempDir();
      await writeFiles(cwd, { "a.md": "a\n" });
      await gitCommitAll(cwd, "base");
      await writeFiles(cwd, { "a.md": "b\n", ":(glob)*.md": "odd\n" });
      expect((await commitPaths(cwd, [":(glob)*.md"], ["chore: odd (T-001)"], HOOKS)).ok).toBe(
        true,
      );
      expect(sh(cwd, "git show --name-only --format= HEAD")).toBe(":(glob)*.md");
      expect(sh(cwd, "git status --short")).toBe("M a.md");
    },
  );

  it("reports a failing hook's output without git's line-ending warnings", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, { "a.md": "a\n" });
    await gitCommitAll(cwd, "base");
    sh(cwd, "git config core.autocrlf true");
    await writeFiles(cwd, {
      "a.md": "b\n",
      ".git/hooks/pre-commit": "#!/bin/sh\necho lint failed >&2\nexit 1\n",
    });
    await chmod(join(cwd, ".git", "hooks", "pre-commit"), 0o755);
    expect(await commitPaths(cwd, ["a.md"], ["chore: hook (T-001)"], HOOKS)).toEqual({
      ok: false,
      details: "lint failed",
    });
    expect((await commitPaths(cwd, ["a.md"], ["chore: hook (T-001)"], { verify: false })).ok).toBe(
      true,
    );
  });

  it("reports that nothing was committed when no path can be added", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, { ".gitignore": "dist/\n", "dist/out.js": "built\n" });
    await gitCommitAll(cwd, "base");
    expect(await commitPaths(cwd, ["dist/out.js"], ["chore: nothing (T-001)"], HOOKS)).toEqual({
      ok: false,
      details: "nothing to commit",
    });
  });
});
