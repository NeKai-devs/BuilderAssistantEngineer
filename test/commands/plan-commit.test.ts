import { execSync } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { writeConfig, writeInterview } from "../../src/config/store.js";
import { fakeBackend, fakePrompter } from "../fakes.js";
import { copyFixture, gitCommitAll, tempDir, writeFiles } from "../helpers.js";
import { planOutput, taskFile } from "../plan-sample.js";

const sh = (cwd: string, command: string) => execSync(command, { cwd }).toString().trim();
const committed = (cwd: string) => sh(cwd, "git show --name-only --format= HEAD").split("\n");
const CONFIRM = "Commit the plan files now, so next starts from them?";

async function configure(cwd: string): Promise<void> {
  await writeConfig(cwd, {
    version: 1,
    mode: "brownfield",
    backend: "claude",
    targets: ["claude-code"],
    lang: "en",
    digest: { maxChars: 20_000 },
  });
  await writeInterview(cwd, "# Interview\n\nAdd team accounts.\n");
}

async function repo(): Promise<string> {
  const cwd = await copyFixture("node-app");
  await gitCommitAll(cwd, "initial");
  await configure(cwd);
  await writeFiles(cwd, { "notes.txt": "mine\n" });
  return cwd;
}

async function plan(cwd: string, args: string[], replies: string[], answers: unknown[] = []) {
  const ui = fakePrompter(answers);
  const ai = fakeBackend(replies);
  const code = await main(["node", "bae", "plan", ...args], cwd, {
    prompter: ui.prompter,
    createBackend: () => ai.backend,
    env: {},
    print: () => {},
  });
  return { code, ui, log: ui.log.join("\n") };
}

describe("plan commits its files", () => {
  it("commits the plan, the config and the interview with --yes, and nothing else", async () => {
    const cwd = await repo();
    const run = await plan(cwd, ["--yes"], [planOutput()]);
    expect(run.code).toBe(0);
    expect(sh(cwd, "git log -1 --format=%s")).toBe("chore(bae): plan");
    const files = committed(cwd);
    for (const path of [
      "AGENTS.md",
      "CLAUDE.md",
      "docs/plan/tasks/T-001-setup-baseline.md",
      ".claude/agents/reviewer.md",
      ".bae/config.json",
      ".bae/interview.md",
      ".gitignore",
    ]) {
      expect(files).toContain(path);
    }
    expect(files.some((path) => path.startsWith(".bae/tmp"))).toBe(false);
    expect(files).not.toContain("notes.txt");
    expect(sh(cwd, "git status --short")).toBe("?? notes.txt");
    expect(run.log).toMatch(/info: Committed the plan as [0-9a-f]+ on main\./);
    expect(run.ui.log.at(-1)).toMatch(/^outro: \d+ file\(s\) written/);
  });

  it("asks first in an interactive run and leaves the files alone when told no", async () => {
    const cwd = await repo();
    const run = await plan(cwd, [], [planOutput()], ["all", false]);
    expect(run.code).toBe(0);
    expect(run.ui.asked).toContain(CONFIRM);
    expect(sh(cwd, "git log -1 --format=%s")).toBe("initial");
  });

  it("commits once, after the plan that runs again with the answers", async () => {
    const cwd = await repo();
    const questions = '[{"question": "Which DB?", "why": "schema", "blocking": true}]';
    const smaller = planOutput({
      files: {
        "AGENTS.md": "# Project",
        "docs/plan/tasks/T-001-setup-baseline.md": taskFile("T-001"),
        ".claude/agents/reviewer.md": "---\nname: reviewer\ndescription: Reviews\n---\nReview.",
      },
    });
    const run = await plan(
      cwd,
      [],
      [planOutput({ questions }), smaller],
      ["all", "postgres", true, "all", true],
    );
    expect(run.code).toBe(0);
    expect(run.ui.asked.filter((question) => question === CONFIRM)).toHaveLength(1);
    expect(sh(cwd, "git log --format=%s").split("\n")).toEqual(["chore(bae): plan", "initial"]);
    expect(committed(cwd)).not.toContain("docs/plan/tasks/T-002-add-feature.md");
    expect(committed(cwd)).toContain("docs/plan/tasks/T-001-setup-baseline.md");
  });

  it("makes the first commit of a repository that has none", async () => {
    const cwd = await tempDir();
    sh(cwd, "git init -q -b main");
    await configure(cwd);
    const run = await plan(cwd, ["--yes"], [planOutput()]);
    expect(run.code).toBe(0);
    expect(sh(cwd, "git log --format=%s")).toBe("chore(bae): plan");
  });

  it("keeps the plan and says so when a hook rejects the commit, unless --no-verify", async () => {
    const cwd = await repo();
    const hook = join(cwd, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\necho lint failed >&2\nexit 1\n");
    await chmod(hook, 0o755);
    const rejected = await plan(cwd, ["--yes"], [planOutput()]);
    expect(rejected.code).toBe(0);
    expect(rejected.log).toContain(
      "warn: Could not commit the plan: lint failed. Commit its files yourself.",
    );
    expect(sh(cwd, "git log -1 --format=%s")).toBe("initial");
    const skipped = await repo();
    await writeFile(join(skipped, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n");
    await chmod(join(skipped, ".git", "hooks", "pre-commit"), 0o755);
    const forced = await plan(skipped, ["--yes", "--no-verify"], [planOutput()]);
    expect(forced.code).toBe(0);
    expect(sh(skipped, "git log -1 --format=%s")).toBe("chore(bae): plan");
  });

  it("does not offer a commit outside a git repository", async () => {
    const cwd = await copyFixture("node-app");
    await configure(cwd);
    const run = await plan(cwd, [], [planOutput()], ["all"]);
    expect(run.code).toBe(0);
    expect(run.ui.asked).not.toContain(CONFIRM);
  });
});
