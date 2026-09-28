import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { fakeBackend, fakePrompter } from "../fakes.js";
import { writeFiles } from "../helpers.js";
import { planOutput, taskFile } from "../plan-sample.js";
import { agent, bypassRepo, next, PASS, REVIEW_PASS, statusOf, TASK } from "./bypass/harness.js";

const sh = (cwd: string, command: string) => execSync(command, { cwd }).toString().trim();
const branch = (cwd: string) => sh(cwd, "git branch --show-current");
const subjects = (cwd: string) => sh(cwd, "git log --format=%s").split("\n");

const SECOND = "docs/plan/tasks/T-002-second.md";
const second = taskFile("T-002", {
  dependsOn: ["T-001"],
  command: PASS,
  scope: "- `src/second.ts`",
  type: "feat",
});

async function handoffTo(cwd: string, path: string): Promise<void> {
  const text = await readFile(join(cwd, path), "utf8");
  await writeFile(join(cwd, path), `${text.trimEnd()}\nDid the second task; no traps.\n`);
}

async function status(cwd: string): Promise<string> {
  const printed: string[] = [];
  await main(["node", "bae", "status"], cwd, {
    prompter: fakePrompter([]).prompter,
    createBackend: () => fakeBackend([]).backend,
    env: {},
    print: (text) => printed.push(text),
  });
  return printed.join("");
}

const COMMIT_MSG = [
  "#!/bin/sh",
  'read -r header < "$1"',
  'case "$header" in',
  '  "feat: "[a-z]*|"fix: "[a-z]*|"chore: "[a-z]*|"chore(bae): "[a-z]*) exit 0 ;;',
  "esac",
  "exit 1",
  "",
].join("\n");

async function hook(cwd: string, name: string, script: string): Promise<void> {
  const path = join(cwd, ".git", "hooks", name);
  await writeFile(path, script);
  await chmod(path, 0o755);
}

describe("next commits each finished task on a bae/ branch", () => {
  it("creates the branch from the current one and commits only the task's changes", async () => {
    const cwd = await bypassRepo();
    await writeFiles(cwd, { "notes.txt": "mine, not the task's\n" });
    const work = agent(cwd, { "src/feature.ts": "export const f = 1;\n" });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(branch(cwd)).toMatch(/^bae\/\d{4}-\d{2}-\d{2}-\d{4}$/);
    expect(run.log).toContain("created from main");
    expect(subjects(cwd)[0]).toBe("chore: do T-001 (T-001)");
    expect(sh(cwd, "git log -1 --format=%b")).toBe("Bae-Task: T-001");
    const files = sh(cwd, "git show --name-only --format= HEAD").split("\n");
    expect(files).toContain("src/feature.ts");
    expect(files).toContain(TASK);
    expect(files).not.toContain("notes.txt");
    expect(sh(cwd, "git status --short")).toContain("notes.txt");
    expect(sh(cwd, "git show HEAD:docs/plan/tasks/T-001-first.md")).toContain("status: done");
    expect(run.log).not.toContain("gh pr create");
  });

  it("asks before creating the branch, and stays put without commits when told no", async () => {
    const cwd = await bypassRepo();
    const work = agent(cwd, { "src/feature.ts": "export const f = 1;\n" });
    const declined = await next(cwd, [], [work, REVIEW_PASS], [false, true]);
    expect(declined.ui.asked[0]).toMatch(
      /^Create the branch bae\/\d{4}-\d{2}-\d{2}-\d{4} from main and commit each finished task there\?$/,
    );
    expect(declined.code).toBe(0);
    expect(declined.log).toContain("Staying on main. Finished tasks are not committed");
    expect(branch(cwd)).toBe("main");
    expect(subjects(cwd)).toEqual(["plan"]);
    expect(await statusOf(cwd)).toBe("done");
  });

  it("keeps committing on the same branch and prints the pull request command after the last task", async () => {
    const cwd = await bypassRepo({ files: { [SECOND]: second } });
    await next(
      cwd,
      ["--yes"],
      [agent(cwd, { "src/feature.ts": "export const f = 1;\n" }), REVIEW_PASS],
    );
    const first = branch(cwd);
    const work = agent(cwd, { "src/second.ts": "export const s = 2;\n" }, () =>
      handoffTo(cwd, SECOND),
    );
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(branch(cwd)).toBe(first);
    expect(subjects(cwd).slice(0, 2)).toEqual([
      "feat: do T-002 (T-002)",
      "chore: do T-001 (T-001)",
    ]);
    expect(run.log).toContain(
      `note: Every task is done on ${first}. Open a pull request with: gh pr create --base main --head ${first}`,
    );
    const shown = await status(cwd);
    expect(shown).toContain(`Branch ${first}, created from main`);
    expect(shown).toContain("feat: do T-002 (T-002)");
    expect(shown).toContain("chore: do T-001 (T-001)");
  });

  it("stops outside the run's branch, and --new-run starts another one", async () => {
    const cwd = await bypassRepo();
    await next(
      cwd,
      ["--yes"],
      [agent(cwd, { "src/feature.ts": "export const f = 1;\n" }), REVIEW_PASS],
    );
    const first = branch(cwd);
    sh(cwd, "git switch -q main");
    const stopped = await next(cwd, ["--yes"], []);
    expect(stopped.code).toBe(1);
    expect(stopped.calls).toHaveLength(0);
    expect(stopped.log).toContain(
      `This run's tasks are committed on ${first}, and you are on main.`,
    );
    expect(await status(cwd)).toContain(
      `This run's tasks are committed on ${first}; you are on main.`,
    );
    const fresh = await next(
      cwd,
      ["--yes", "--new-run"],
      [agent(cwd, { "src/feature.ts": "export const f = 2;\n" }), REVIEW_PASS],
    );
    expect(fresh.code).toBe(0);
    expect(branch(cwd)).not.toBe(first);
    expect(branch(cwd)).toMatch(/^bae\//);
  });

  it("runs the repository's hooks, and a conventional commit-msg check accepts the message", async () => {
    const cwd = await bypassRepo();
    await hook(cwd, "commit-msg", COMMIT_MSG);
    await hook(cwd, "post-commit", "#!/bin/sh\necho ran > hooked\n");
    const run = await next(cwd, ["--yes"], [agent(cwd, { "src/feature.ts": "x\n" }), REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(subjects(cwd)[0]).toBe("chore: do T-001 (T-001)");
    expect(existsSync(join(cwd, "hooked"))).toBe(true);
  });

  it("keeps the task done and the commit pending when a hook fails, unless --no-verify", async () => {
    const failing = "#!/bin/sh\necho lint failed >&2\nexit 1\n";
    const cwd = await bypassRepo();
    await hook(cwd, "pre-commit", failing);
    const run = await next(cwd, ["--yes"], [agent(cwd, { "src/feature.ts": "x\n" }), REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(await statusOf(cwd)).toBe("done");
    expect(run.log).toMatch(/warn: Could not commit T-001: [^\n]*lint failed\./);
    expect(subjects(cwd)).toEqual(["plan"]);
    const skipped = await bypassRepo();
    await hook(skipped, "pre-commit", failing);
    const work = agent(skipped, { "src/feature.ts": "x\n" });
    const forced = await next(skipped, ["--yes", "--no-verify"], [work, REVIEW_PASS]);
    expect(forced.code).toBe(0);
    expect(subjects(skipped)[0]).toBe("chore: do T-001 (T-001)");
  });

  it("keeps the task done and says so when git cannot commit", async () => {
    const cwd = await bypassRepo();
    sh(cwd, "git config commit.gpgsign true");
    sh(cwd, "git config gpg.program bae-missing-gpg");
    const run = await next(cwd, ["--yes"], [agent(cwd, { "src/feature.ts": "x\n" }), REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(await statusOf(cwd)).toBe("done");
    expect(run.log).toContain("Could not commit T-001");
    expect(subjects(cwd)).toEqual(["plan"]);
  });
});

describe("replan respects the run's branch", () => {
  const plan = () =>
    planOutput({
      files: {
        "AGENTS.md": "# Rules\n",
        ".claude/agents/reviewer.md":
          "---\nname: reviewer\ndescription: Strict\n---\nReject shortcuts.",
        "docs/plan/CHANGELOG.md": "## Replan\n\nAdded T-003.",
        "docs/plan/tasks/T-002-second.md": taskFile("T-002", { dependsOn: ["T-001"] }),
        "docs/plan/tasks/T-003-third.md": taskFile("T-003", { dependsOn: ["T-002"] }),
      },
    });
  const replan = async (cwd: string) => {
    const ui = fakePrompter([]);
    const code = await main(["node", "bae", "replan", "--yes"], cwd, {
      prompter: ui.prompter,
      createBackend: () => fakeBackend([plan()]).backend,
      env: {},
      print: () => {},
    });
    return { code, log: ui.log.join("\n") };
  };

  it("commits the new plan on the run's branch and refuses to replan elsewhere", async () => {
    const cwd = await bypassRepo();
    await next(
      cwd,
      ["--yes"],
      [agent(cwd, { "src/feature.ts": "export const f = 1;\n" }), REVIEW_PASS],
    );
    const run = branch(cwd);
    const done = await replan(cwd);
    expect(done.code).toBe(0);
    expect(branch(cwd)).toBe(run);
    expect(subjects(cwd)[0]).toBe("chore(bae): replan");
    expect(sh(cwd, "git show --name-only --format= HEAD")).toContain(
      "docs/plan/tasks/T-003-third.md",
    );
    sh(cwd, "git switch -q main");
    const refused = await replan(cwd);
    expect(refused.code).toBe(1);
    expect(refused.log).toContain(`before replanning, so the new plan lands next to them`);
  });
});
