import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { writeConfig } from "../../src/config/store.js";
import { splitFrontmatter } from "../../src/tasks/frontmatter.js";
import { fakePrompter, type Step, scriptedBackend } from "../fakes.js";
import { gitCommitAll, tempDir, writeFiles } from "../helpers.js";
import { taskFile } from "../plan-sample.js";

const PASS = 'node -e "process.exit(0)"';
const FAIL = 'node -e "process.exit(1)"';
const NEEDS_FILE = `node -e "process.exit(require('fs').existsSync('done.txt') ? 0 : 1)"`;
const BREAKS_WITH = (file: string) =>
  `node -e "process.exit(require('fs').existsSync('${file}') ? 1 : 0)"`;
const REVIEW_PASS = () => '{"verdict": "pass", "findings": []}';
async function addLog(cwd: string, note = "Added the feature file; no traps.") {
  const path = join(cwd, "docs/plan/tasks/T-001-first.md");
  await writeFile(path, `${(await readFile(path, "utf8")).trimEnd()}\n${note}\n`);
}

const writesFile =
  (cwd: string, name: string): Step =>
  async () => {
    await writeFiles(cwd, { [name]: "work\n" });
    await addLog(cwd);
    return "";
  };

type RepoOptions = {
  git?: boolean;
  backend?: "claude" | "manual";
  commands?: Record<string, string>;
  regression?: "full" | "task" | "off";
};

async function repo(command: string, options: RepoOptions = {}) {
  const cwd = await tempDir();
  await writeFiles(cwd, {
    "AGENTS.md": "# Rules\n",
    "docs/plan/tasks/T-001-first.md": taskFile("T-001", { command }),
    "docs/plan/tasks/T-002-second.md": taskFile("T-002", { dependsOn: ["T-001"] }),
  });
  await writeConfig(cwd, {
    version: 1,
    mode: "greenfield",
    backend: options.backend ?? "claude",
    targets: ["claude-code"],
    lang: "en",
    digest: { maxChars: 20_000 },
    commands: options.commands ?? {},
    gates: { regression: options.regression ?? "full" },
  });
  if (options.git !== false) await gitCommitAll(cwd, "plan");
  return cwd;
}

async function runNext(cwd: string, args: string[], steps: Step[], answers: unknown[] = []) {
  const ui = fakePrompter(answers);
  const ai = scriptedBackend(steps);
  const printed: string[] = [];
  const names: string[] = [];
  const code = await main(["node", "bae", "next", ...args], cwd, {
    prompter: ui.prompter,
    createBackend: (name) => {
      names.push(name);
      return ai.backend;
    },
    env: {},
    print: (text) => printed.push(text),
  });
  return { code, ui, calls: ai.calls, names, printed: printed.join("") };
}

const statusOf = async (cwd: string, path: string) =>
  splitFrontmatter(await readFile(join(cwd, path), "utf8"))?.data.status;

const logs = async (cwd: string, id: string) =>
  (await readdir(join(cwd, ".bae", "runs", id))).filter((name) => name.endsWith(".md"));

describe("next", () => {
  it("opens an interactive session, verifies, reviews and marks the task done", async () => {
    const cwd = await repo(PASS);
    const { code, calls, ui, printed } = await runNext(
      cwd,
      [],
      [writesFile(cwd, "feature.txt"), REVIEW_PASS],
      [true],
    );
    expect(code).toBe(0);
    expect(calls[0]?.options).toMatchObject({ interactive: true });
    expect(calls[0]?.prompt).toContain("id: T-001");
    expect(calls[0]?.prompt).toContain("do not edit this task file");
    expect(calls[1]?.options).toMatchObject({ access: "read" });
    expect(calls[1]?.prompt).toContain("new file: feature.txt");
    expect(calls[1]?.prompt).toContain("# Rules");
    expect(printed).toContain(`$ ${PASS}`);
    expect(await statusOf(cwd, "docs/plan/tasks/T-001-first.md")).toBe("done");
    expect(await logs(cwd, "T-001")).toHaveLength(1);
    expect(await readFile(join(cwd, ".gitignore"), "utf8")).toContain(".bae/runs/");
    expect(ui.log.at(-1)).toBe("outro: T-001 is done. Next: npx builder-assistant-engineer next");
  });

  it("keeps the task in progress when verification fails, and resumes it next time", async () => {
    const cwd = await repo(FAIL);
    const first = await runNext(cwd, ["--yes"], [writesFile(cwd, "a.txt")]);
    expect(first.code).toBe(1);
    expect(await statusOf(cwd, "docs/plan/tasks/T-001-first.md")).toBe("in_progress");
    expect(first.ui.log).toContain(`warn: Verification failed: \`${FAIL}\` exited with 1.`);
    const second = await runNext(cwd, ["--dry-run"], []);
    expect(second.printed).toContain("id: T-001");
  });

  it("restores the task status when the agent edits it", async () => {
    const cwd = await repo(FAIL);
    const editsTask: Step = async () => {
      await writeFiles(cwd, {
        "docs/plan/tasks/T-001-first.md": taskFile("T-001", { status: "completed", command: FAIL }),
      });
      return "";
    };
    const { code } = await runNext(cwd, ["--yes"], [editsTask]);
    expect(code).toBe(1);
    expect(await statusOf(cwd, "docs/plan/tasks/T-001-first.md")).toBe("in_progress");
  });

  it("fails the gate when the reviewer rejects the change", async () => {
    const cwd = await repo(PASS);
    const review = () =>
      '{"verdict": "fail", "findings": [{"severity": "blocker", "message": "missing tests"}]}';
    const { code, ui } = await runNext(cwd, ["--yes"], [writesFile(cwd, "a.txt"), review]);
    expect(code).toBe(1);
    expect(ui.log.join("\n")).toContain("- [blocker] missing tests");
    expect(await statusOf(cwd, "docs/plan/tasks/T-001-first.md")).toBe("in_progress");
  });

  it("retries headless runs with the failure output and succeeds", async () => {
    const cwd = await repo(NEEDS_FILE);
    const { code, calls, ui } = await runNext(
      cwd,
      ["--headless", "--yes"],
      [writesFile(cwd, "partial.txt"), writesFile(cwd, "done.txt"), REVIEW_PASS],
    );
    expect(code).toBe(0);
    expect(calls[0]?.options).toMatchObject({ access: "edit" });
    expect(calls[1]?.prompt).toContain("The previous attempt did not pass (attempt 1)");
    expect(calls[1]?.prompt).toContain("(exit 1)");
    expect(ui.log.filter((line) => line.includes("Attempt "))).toHaveLength(2);
    expect(await statusOf(cwd, "docs/plan/tasks/T-001-first.md")).toBe("done");
  });

  it("blocks the task after two failed retries, keeps the logs and records a lesson", async () => {
    const cwd = await repo(FAIL);
    const noop: Step = () => "";
    const lesson = () =>
      '{"root_cause": "The command was never implemented.", "rule": "Run the Verification commands before finishing."}';
    const { code, calls, ui } = await runNext(
      cwd,
      ["--headless", "--yes"],
      [noop, noop, noop, lesson],
    );
    expect(code).toBe(1);
    expect(calls).toHaveLength(4);
    expect(calls[3]?.options).toMatchObject({ access: "read" });
    expect(calls[3]?.prompt).toContain("was blocked after every automatic retry failed");
    expect(calls[3]?.prompt).toContain("# Attempt 3");
    expect(await statusOf(cwd, "docs/plan/tasks/T-001-first.md")).toBe("blocked");
    expect(await logs(cwd, "T-001")).toHaveLength(4);
    expect(ui.log).toContain("success: Rule added to AGENTS.md.");
    expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe(
      "# Rules\n\n<!-- bae:begin -->\n## Lessons learned\n\n<!-- bae:lessons -->\n- Run the Verification commands before finishing.\n<!-- bae:lessons:end -->\n<!-- bae:end -->\n",
    );
    const attempts = (await readFile(join(cwd, ".bae/runs/T-001/attempts.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(attempts.map((attempt) => [attempt.outcome, attempt.stage, attempt.headless])).toEqual([
      ["failed", "verification", true],
      ["failed", "verification", true],
      ["blocked", "verification", true],
    ]);
  });

  it("refuses unsafe verification commands even with --yes and does not retry", async () => {
    const cwd = await repo("rm -rf build");
    const { code, calls, ui } = await runNext(cwd, ["--headless", "--yes"], [() => ""]);
    expect(code).toBe(1);
    expect(calls).toHaveLength(1);
    expect(ui.log).toContain(
      "warn: Refusing to run `rm -rf build` (rm -rf). Fix the task's Verification section.",
    );
  });

  it("uses the manual flow for api and manual backends and skips review outside git", async () => {
    const cwd = await repo(PASS, { git: false, backend: "manual" });
    const { code, names, ui } = await runNext(cwd, ["--yes"], [() => addLog(cwd).then(() => "")]);
    expect(code).toBe(0);
    expect(names).toEqual(["manual"]);
    expect(ui.log.join("\n")).toContain("Review skipped: this is not a git repository");
    expect(await statusOf(cwd, "docs/plan/tasks/T-001-first.md")).toBe("done");
  });

  it("does not run verification when the user declines", async () => {
    const cwd = await repo(PASS);
    const { code } = await runNext(cwd, [], [() => ""], [false]);
    expect(code).toBe(1);
    expect(await statusOf(cwd, "docs/plan/tasks/T-001-first.md")).toBe("in_progress");
  });

  it("changes nothing on --dry-run and reports when everything is done", async () => {
    const cwd = await repo(PASS);
    const dry = await runNext(cwd, ["--dry-run"], []);
    expect(dry.calls).toEqual([]);
    expect(await statusOf(cwd, "docs/plan/tasks/T-001-first.md")).toBe("pending");
    await writeFiles(cwd, {
      "docs/plan/tasks/T-001-first.md": taskFile("T-001", { status: "done" }),
      "docs/plan/tasks/T-002-second.md": taskFile("T-002", { status: "done" }),
    });
    const done = await runNext(cwd, [], []);
    expect(done.ui.log.at(-1)).toBe("outro: Every task is done.");
  });
});

describe("next regression gate", () => {
  const TASK = "docs/plan/tasks/T-001-first.md";

  it("records a failing baseline as preexisting and does not block the task", async () => {
    const cwd = await repo(PASS, { commands: { test: FAIL, lint: PASS } });
    const { code, ui } = await runNext(cwd, ["--yes"], [writesFile(cwd, "a.txt"), REVIEW_PASS]);
    expect(code).toBe(0);
    expect(ui.log).toContain(
      `warn: \`${FAIL}\` already fails before the task (exit 1); recorded as preexisting, it will not block.`,
    );
    expect(ui.log).toContain(`info: \`${FAIL}\` still fails (exit 1), as it did before the task.`);
    expect(JSON.parse(await readFile(join(cwd, ".bae/runs/T-001/baseline.json"), "utf8"))).toEqual({
      skipped: false,
      exitCodes: { lint: 0, test: 1 },
    });
    expect(await statusOf(cwd, TASK)).toBe("done");
  });

  it("keeps the task in progress when it turns a passing command red", async () => {
    const test = BREAKS_WITH("broken.txt");
    const cwd = await repo(PASS, { commands: { test } });
    const { code, ui, calls } = await runNext(cwd, ["--yes"], [writesFile(cwd, "broken.txt")]);
    expect(code).toBe(1);
    expect(calls).toHaveLength(1);
    expect(ui.log).toContain(`warn: Regression: \`${test}\` exits with 1 after the task.`);
    expect(await statusOf(cwd, TASK)).toBe("in_progress");
    const [log] = await logs(cwd, "T-001");
    const report = await readFile(join(cwd, ".bae/runs/T-001", log ?? ""), "utf8");
    expect(report).toContain("regression: it passed before the task");
  });

  it("retries headless runs with the regression output until the command is green again", async () => {
    const test = BREAKS_WITH("broken.txt");
    const cwd = await repo(PASS, { commands: { test } });
    const fixes: Step = async () => {
      await rm(join(cwd, "broken.txt"));
      await writeFiles(cwd, { "fixed.txt": "ok\n" });
      return "";
    };
    const { code, calls } = await runNext(
      cwd,
      ["--headless", "--yes"],
      [writesFile(cwd, "broken.txt"), fixes, REVIEW_PASS],
    );
    expect(code).toBe(0);
    expect(calls[1]?.prompt).toContain("## Regression check");
    expect(await statusOf(cwd, TASK)).toBe("done");
  });

  it("runs the suite only after the task in task mode, so any red command blocks", async () => {
    const cwd = await repo(PASS, { commands: { test: FAIL }, regression: "task" });
    const { code, ui } = await runNext(cwd, ["--yes"], [writesFile(cwd, "a.txt")]);
    expect(code).toBe(1);
    expect(ui.log).toContain(`warn: Regression: \`${FAIL}\` exits with 1 after the task.`);
    expect(await readdir(join(cwd, ".bae/runs/T-001"))).not.toContain("baseline.json");
  });

  it("runs no suite when the gate is off and reuses verification results", async () => {
    const off = await repo(PASS, { commands: { test: FAIL }, regression: "off" });
    const first = await runNext(off, ["--yes"], [writesFile(off, "a.txt"), REVIEW_PASS]);
    expect(first.code).toBe(0);
    expect(first.printed).not.toContain(`$ ${FAIL}`);
    const same = await repo(PASS, { commands: { test: PASS } });
    const second = await runNext(same, ["--yes"], [writesFile(same, "a.txt"), REVIEW_PASS]);
    expect(second.code).toBe(0);
    expect(second.printed.split(`$ ${PASS}`)).toHaveLength(3);
  });

  it("lets the user skip the baseline, which turns the check off for that task", async () => {
    const cwd = await repo(PASS, { commands: { test: FAIL } });
    const { code, ui } = await runNext(
      cwd,
      [],
      [writesFile(cwd, "a.txt"), REVIEW_PASS],
      [false, true],
    );
    expect(code).toBe(0);
    expect(ui.log).toContain("warn: Baseline skipped; the regression check is off for this task.");
  });

  it("refuses unsafe project commands", async () => {
    const cwd = await repo(PASS, { commands: { lint: "sudo make lint" } });
    const { code, ui } = await runNext(cwd, ["--yes"], [writesFile(cwd, "a.txt")]);
    expect(code).toBe(1);
    expect(ui.log).toContain(
      "warn: Refusing to run `sudo make lint` (sudo). Fix the commands in .bae/config.json.",
    );
  });
});

describe("next mechanical review", () => {
  it("ignores files that were already uncommitted before the task, unless the task changes them", async () => {
    const cwd = await repo(PASS);
    await writeFiles(cwd, { ".env": "API_TOKEN=abc\n", "docs/plan/00-overview.md": "# Plan\n" });
    const first = await runNext(cwd, ["--yes"], [writesFile(cwd, "feature.txt"), REVIEW_PASS]);
    expect(first.code).toBe(0);
    expect(first.calls[1]?.prompt).not.toContain(".env");
    expect(first.calls[1]?.prompt).not.toContain("docs/plan/00-overview.md");
    expect(first.calls[1]?.prompt).toContain("new file: feature.txt");
    const cwd2 = await repo(PASS);
    await writeFiles(cwd2, { ".env": "API_TOKEN=abc\n" });
    const edits: Step = async () => {
      await writeFiles(cwd2, { ".env": "API_TOKEN=changed\n" });
      await addLog(cwd2);
      return "";
    };
    const second = await runNext(cwd2, ["--yes"], [edits]);
    expect(second.code).toBe(1);
    expect(second.ui.log.join("\n")).toContain("- [blocker] .env: Looks like a secrets file");
  });

  it("skips the reviewer when the change adds a secrets file and retries with the finding", async () => {
    const cwd = await repo(PASS);
    const cleans: Step = async () => {
      await rm(join(cwd, ".env"));
      await writeFiles(cwd, { "feature.txt": "work\n" });
      return "";
    };
    const { code, calls } = await runNext(
      cwd,
      ["--headless", "--yes"],
      [writesFile(cwd, ".env"), cleans, REVIEW_PASS],
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(3);
    expect(calls[1]?.prompt).toContain("- [blocker] .env: Looks like a secrets file");
    expect(calls[2]?.options).toMatchObject({ access: "read" });
  });
});

describe("next handoff note", () => {
  it("opens the prompt with the plan state, the commands and the last three notes", async () => {
    const cwd = await repo(PASS, { commands: { test: PASS } });
    const done = (id: string, deps: string[]) =>
      taskFile(id, { status: "done", dependsOn: deps, log: `Note from ${id}.` });
    await writeFiles(cwd, {
      "docs/plan/tasks/T-001-first.md": done("T-001", []),
      "docs/plan/tasks/T-002-second.md": done("T-002", ["T-001"]),
      "docs/plan/tasks/T-003-third.md": done("T-003", ["T-002"]),
      "docs/plan/tasks/T-004-fourth.md": done("T-004", ["T-003"]),
      "docs/plan/tasks/T-005-fifth.md": taskFile("T-005", { dependsOn: ["T-004"] }),
      "docs/plan/tasks/T-006-sixth.md": taskFile("T-006", { dependsOn: ["T-005"] }),
      "docs/plan/tasks/T-007-seventh.md": taskFile("T-007", { status: "blocked" }),
    });
    const { calls } = await runNext(cwd, ["--yes"], [() => ""]);
    const prompt = calls[0]?.prompt ?? "";
    expect(prompt).toContain(
      "## Where the plan stands\n\n- Done: 4 of 7 tasks. You are on T-005 (phase 1).\n- Blocked, do not work on them: T-007 Do T-007\n- Up next after this task: T-006 Do T-006",
    );
    expect(prompt).toContain(`## Project commands\n\n- test: \`${PASS}\``);
    expect(prompt).toContain("### T-004 Do T-004\n\nNote from T-004.");
    expect(prompt).toContain("### T-002 Do T-002\n\nNote from T-002.");
    expect(prompt).not.toContain("Note from T-001.");
    expect(prompt).toContain("under `## Log` in docs/plan/tasks/T-005-fifth.md");
  });

  it("adds a Log heading to task files from older plans when the task starts", async () => {
    const cwd = await repo(PASS);
    const path = "docs/plan/tasks/T-001-first.md";
    await writeFiles(cwd, { [path]: taskFile("T-001", { command: PASS }).replace("## Log\n", "") });
    await runNext(cwd, ["--yes"], [() => ""]);
    expect(await readFile(join(cwd, path), "utf8")).toMatch(/None\.\n\n## Log\n$/);
  });

  it("keeps the task out of done until the agent writes a short handoff note", async () => {
    const cwd = await repo(PASS);
    const silent: Step = async () => {
      await writeFiles(cwd, { "feature.txt": "work\n" });
      return "";
    };
    const verbose: Step = () =>
      addLog(cwd, Array.from({ length: 9 }, (_, index) => `line ${index + 1}`).join("\n")).then(
        () => "",
      );
    const lesson = () => '{"root_cause": "No note.", "rule": "Write the Log before exiting."}';
    const { code, calls, ui } = await runNext(
      cwd,
      ["--headless", "--yes"],
      [silent, verbose, () => "", lesson],
    );
    expect(code).toBe(1);
    expect(calls).toHaveLength(4);
    expect(calls[1]?.prompt).toContain(
      "docs/plan/tasks/T-001-first.md has no handoff note: write at most 8 lines under ## Log",
    );
    expect(calls[2]?.prompt).toContain(
      "The handoff note in docs/plan/tasks/T-001-first.md has 9 lines; keep it to 8.",
    );
    expect(ui.log.join("\n")).not.toContain("Review passed.");
  });
});

describe("next lessons", () => {
  const REVIEW_FAIL = () =>
    '{"verdict": "fail", "findings": [{"severity": "blocker", "message": "no tests"}]}';
  const LESSON = () =>
    '{"root_cause": "Tests were skipped.", "rule": "- Add a test for every new route.\\nExtra line."}';

  it("asks for a lesson once, after the second failed review, and respects a refusal", async () => {
    const cwd = await repo(PASS);
    const first = await runNext(cwd, [], [writesFile(cwd, "a.txt"), REVIEW_FAIL], [true]);
    expect(first.calls).toHaveLength(2);
    const second = await runNext(
      cwd,
      [],
      [writesFile(cwd, "b.txt"), REVIEW_FAIL, LESSON],
      [true, false],
    );
    expect(second.calls).toHaveLength(3);
    expect(second.calls[2]?.prompt).toContain("failed its review twice");
    expect(second.ui.log).toContain(
      "note: Lesson from T-001 Root cause: Tests were skipped.\nRule: Add a test for every new route.",
    );
    expect(second.ui.log).toContain("info: Rule not added; it stays in .bae/runs/T-001/lesson.md.");
    expect(await readFile(join(cwd, ".bae/runs/T-001/lesson.md"), "utf8")).toContain(
      "- Added to AGENTS.md: no",
    );
    expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe("# Rules\n");
    const third = await runNext(cwd, [], [writesFile(cwd, "c.txt"), REVIEW_FAIL], [true]);
    expect(third.calls).toHaveLength(2);
  });

  it("adds the rule before the next headless attempt so the agent reads it", async () => {
    const cwd = await repo(PASS);
    const { code, calls } = await runNext(
      cwd,
      ["--headless", "--yes"],
      [
        writesFile(cwd, "a.txt"),
        REVIEW_FAIL,
        writesFile(cwd, "b.txt"),
        REVIEW_FAIL,
        LESSON,
        writesFile(cwd, "c.txt"),
        REVIEW_PASS,
      ],
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(7);
    expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toContain(
      "- Add a test for every new route.",
    );
    expect(calls[6]?.prompt).not.toContain("diff --git a/AGENTS.md");
    expect(calls[6]?.prompt).toContain("new file: c.txt");
  });
});
