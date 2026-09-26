import { readdir, readFile } from "node:fs/promises";
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
const REVIEW_PASS = () => '{"verdict": "pass", "findings": []}';
const writesFile =
  (cwd: string, name: string): Step =>
  async () => {
    await writeFiles(cwd, { [name]: "work\n" });
    return "";
  };

async function repo(
  command: string,
  options: { git?: boolean; backend?: "claude" | "manual" } = {},
) {
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

  it("blocks the task after two failed retries and keeps the logs", async () => {
    const cwd = await repo(FAIL);
    const noop: Step = () => "";
    const { code, calls } = await runNext(cwd, ["--headless", "--yes"], [noop, noop, noop]);
    expect(code).toBe(1);
    expect(calls).toHaveLength(3);
    expect(await statusOf(cwd, "docs/plan/tasks/T-001-first.md")).toBe("blocked");
    expect(await logs(cwd, "T-001")).toHaveLength(3);
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
    const { code, names, ui } = await runNext(cwd, ["--yes"], [() => ""]);
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
