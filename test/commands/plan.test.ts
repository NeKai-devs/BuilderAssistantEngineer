import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { writeConfig, writeInterview } from "../../src/config/store.js";
import { fakeBackend, fakePrompter } from "../fakes.js";
import { copyFixture, tempDir, writeFiles } from "../helpers.js";
import { planOutput, taskFile } from "../plan-sample.js";

const read = (cwd: string, path: string) => readFile(join(cwd, path), "utf8");
const exists = (cwd: string, path: string) =>
  read(cwd, path).then(
    () => true,
    () => false,
  );

async function setup(
  targets: ("claude-code" | "opencode" | "codex" | "gemini")[] = ["claude-code"],
) {
  const cwd = await copyFixture("node-app");
  await writeConfig(cwd, {
    version: 1,
    mode: "brownfield",
    backend: "claude",
    targets,
    lang: "en",
    digest: { maxChars: 20_000 },
  });
  await writeInterview(cwd, "# Interview\n\nAdd team accounts.\n");
  return cwd;
}

async function runPlan(cwd: string, args: string[], replies: string[], answers: unknown[] = []) {
  const ui = fakePrompter(answers);
  const ai = fakeBackend(replies);
  const printed: string[] = [];
  const code = await main(["node", "bae", "plan", ...args], cwd, {
    prompter: ui.prompter,
    createBackend: () => ai.backend,
    env: {},
    print: (text) => printed.push(text),
  });
  return { code, ui, ai, printed: printed.join("") };
}

describe("plan", () => {
  it("sends the PLAN prompt and writes the targeted artifacts", async () => {
    const cwd = await setup();
    await writeFiles(cwd, { "AGENTS.md": "# Team notes\n" });
    const questions =
      '[{"question": "Which DB?", "why": "schema", "blocking": true}, {"question": "Name?", "why": "branding"}]';
    const { code, ui, ai } = await runPlan(cwd, ["--yes"], [planOutput({ questions })]);
    expect(code).toBe(0);
    expect(ai.prompts[0]).toContain("- MODE: PLAN");
    expect(ai.prompts[0]).toContain("Add team accounts.");
    expect(ai.prompts[0]).toContain("- tests: present");
    expect(await read(cwd, "AGENTS.md")).toBe(
      "# Team notes\n\n<!-- bae:begin -->\n# Project\n\nRun npm test.\n<!-- bae:end -->\n",
    );
    expect(await read(cwd, "CLAUDE.md")).toContain("@AGENTS.md");
    expect(await read(cwd, "docs/plan/tasks/T-002-add-feature.md")).toContain(
      "depends_on: [T-001]",
    );
    expect(await exists(cwd, ".claude/agents/reviewer.md")).toBe(true);
    expect(await exists(cwd, ".opencode/agent/reviewer.md")).toBe(false);
    expect(ui.log.join("\n")).toContain("1. [blocking] Which DB? — schema");
    expect(JSON.parse(await read(cwd, ".bae/tmp/plan-report.json"))).toMatchObject({
      questions: 2,
      blockingQuestions: 1,
      files: 8,
    });
    expect(ui.log.at(-1)).toBe(
      "outro: 7 file(s) written. Next: npx builder-assistant-engineer next",
    );
  });

  it("prints the exact prompt on --dry-run without calling the AI or writing", async () => {
    const cwd = await setup();
    const { code, ai, printed } = await runPlan(cwd, ["--dry-run"], []);
    expect(code).toBe(0);
    expect(ai.prompts).toEqual([]);
    expect(printed).toContain("- MODE: PLAN");
    expect(printed).toContain("<repo_digest>\n# Repository digest");
    expect(await exists(cwd, "docs/plan/tasks/T-001-setup-baseline.md")).toBe(false);
  });

  it("writes only the requested group with --only", async () => {
    const cwd = await setup();
    await runPlan(cwd, ["--yes", "--only", "memory"], [planOutput()]);
    expect(await exists(cwd, "AGENTS.md")).toBe(true);
    expect(await exists(cwd, "docs/plan/tasks/T-001-setup-baseline.md")).toBe(false);
    expect(await exists(cwd, ".claude/agents/reviewer.md")).toBe(false);
  });

  it("asks the analyst to continue an answer cut off by the output limit", async () => {
    const cwd = await setup();
    const full = planOutput();
    const cut = full.indexOf("<<<FILE: docs/plan/tasks/T-002-add-feature.md>>>") + 60;
    const rest = full.slice(full.indexOf("<<<FILE: docs/plan/tasks/T-002-add-feature.md>>>"));
    const { code, ai, ui } = await runPlan(
      cwd,
      ["--yes"],
      [full.slice(0, cut), `Continuing.\n${rest}`],
    );
    expect(code).toBe(0);
    expect(ui.log).toContain(
      "warn: The answer was cut off at <<<FILE: docs/plan/tasks/T-002-add-feature.md>>>; asking the analyst to continue from there.",
    );
    expect(ai.prompts[1]).toContain("- MODE: PLAN");
    expect(ai.prompts[1]).toContain("start with <<<FILE: docs/plan/tasks/T-002-add-feature.md>>>");
    expect(await exists(cwd, "docs/plan/tasks/T-002-add-feature.md")).toBe(true);
    expect(await exists(cwd, ".claude/commands/next.md")).toBe(true);
    expect(JSON.parse(await read(cwd, ".bae/tmp/plan-report.json"))).toMatchObject({
      backend: "claude",
      ok: true,
      continuations: 1,
      formatRetries: 0,
      tasks: 2,
    });
  });

  it("retries once when the answer is malformed", async () => {
    const cwd = await setup();
    const { code, ai } = await runPlan(cwd, ["--yes"], ["no blocks here", planOutput()]);
    expect(code).toBe(0);
    expect(ai.prompts[1]).toContain("expected exactly one SUMMARY block, found 0");
    expect(await exists(cwd, "docs/plan/00-overview.md")).toBe(true);
    expect(JSON.parse(await read(cwd, ".bae/tmp/plan-report.json"))).toMatchObject({
      formatRetries: 1,
      formatErrors: [expect.stringContaining("expected exactly one SUMMARY block")],
    });
  });

  it("writes a failed report when the answer cannot be parsed", async () => {
    const cwd = await setup();
    const { code } = await runPlan(cwd, ["--yes"], ["nope", "still nope"]);
    expect(code).toBe(1);
    const report = JSON.parse(await read(cwd, ".bae/tmp/plan-report.json"));
    expect(report).toMatchObject({ ok: false, formatRetries: 1, tasks: 0 });
    expect(report.error).toContain("output format");
  });

  it("asks before regenerating an existing plan and never overwrites done tasks", async () => {
    const cwd = await setup();
    await writeFiles(cwd, {
      "docs/plan/tasks/T-001-setup-baseline.md": taskFile("T-001", {
        status: "done",
        title: "Original",
      }),
    });
    const declined = await runPlan(cwd, [], [], [false]);
    expect(declined.ai.prompts).toEqual([]);
    await runPlan(cwd, ["--yes"], [planOutput()]);
    expect(await read(cwd, "docs/plan/tasks/T-001-setup-baseline.md")).toContain("title: Original");
  });

  it("lets the user reject the changes", async () => {
    const cwd = await setup();
    const { code, ui } = await runPlan(cwd, [], [planOutput()], ["none"]);
    expect(code).toBe(0);
    expect(await exists(cwd, "AGENTS.md")).toBe(false);
    expect(ui.log.at(-1)).toBe("outro: No files were written.");
  });

  it("requires a config", async () => {
    const { code } = await runPlan(await tempDir(), ["--yes"], []);
    expect(code).toBe(1);
  });
});
