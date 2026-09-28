import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Backend } from "../../src/backends/types.js";
import { main } from "../../src/cli.js";
import { readConfig, writeConfig, writeInterview } from "../../src/config/store.js";
import { UserError } from "../../src/core/errors.js";
import { fakeBackend, fakePrompter } from "../fakes.js";
import { copyFixture, tempDir, writeFiles } from "../helpers.js";
import { defaultFiles, planOutput, taskFile } from "../plan-sample.js";

const read = (cwd: string, path: string) => readFile(join(cwd, path), "utf8");
const exists = (cwd: string, path: string) =>
  read(cwd, path).then(
    () => true,
    () => false,
  );

async function setup(
  targets: ("claude-code" | "opencode" | "codex" | "gemini")[] = ["claude-code"],
  commands: Record<string, string> = {},
) {
  const cwd = await copyFixture("node-app");
  await writeConfig(cwd, {
    version: 1,
    mode: "brownfield",
    backend: "claude",
    targets,
    lang: "en",
    digest: { maxChars: 20_000 },
    commands,
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

  it("saves project commands: stored values first, then the analyst's, then the manifests'", async () => {
    const cwd = await setup(["claude-code"], { test: "npm run test:ci" });
    const config =
      '{"commands": {"test": "npm test", "lint": "npm run lint:strict", "typecheck": "npx tsc --noEmit", "build": null}}';
    const { code, ui } = await runPlan(cwd, ["--yes"], [planOutput({ config })]);
    expect(code).toBe(0);
    expect((await readConfig(cwd))?.commands).toEqual({
      test: "npm run test:ci",
      lint: "npm run lint:strict",
      typecheck: "npx tsc --noEmit",
      build: "npm run build",
    });
    expect(ui.log.join("\n")).toContain(
      "note: Project commands saved to .bae/config.json lint: npm run lint:strict\ntypecheck: npx tsc --noEmit\nbuild: npm run build",
    );
  });

  it("asks the analyst to fix only the cited paths that do not exist", async () => {
    const cwd = await setup();
    const files = {
      ...defaultFiles(),
      "docs/plan/02-architecture.md": "Routes live in `src/routes/user.ts`.",
    };
    const fix =
      "<<<FILE: docs/plan/02-architecture.md>>>\nRoutes live in `src/routes/users.ts`.\n<<<END FILE>>>";
    const { code, ai, ui } = await runPlan(cwd, ["--yes"], [planOutput({ files }), fix]);
    expect(code).toBe(0);
    expect(ui.log).toContain(
      "warn: 1 cited path(s) are not in the repository and not marked (new); asking the analyst to fix only those.",
    );
    expect(ai.prompts[1]).toContain("- `src/routes/user.ts` in docs/plan/02-architecture.md");
    expect(ai.prompts[1]).toContain("<<<FILE: docs/plan/02-architecture.md>>>");
    expect(ai.prompts[1]).not.toContain("<<<FILE: AGENTS.md>>>");
    expect(ai.prompts[1]).toMatch(/<repository_files>[\s\S]*src\/routes\/users\.ts/);
    expect(await read(cwd, "docs/plan/02-architecture.md")).toBe(
      "Routes live in `src/routes/users.ts`.\n",
    );
    expect(JSON.parse(await read(cwd, ".bae/tmp/plan-report.json"))).toMatchObject({
      evidenceRetries: 1,
      unverifiedPaths: [],
    });
  });

  it("keeps and writes the plan when the request to fix paths fails", async () => {
    const cwd = await setup();
    const files = {
      ...defaultFiles(),
      "docs/plan/02-architecture.md": "Routes live in `src/routes/user.ts`.",
    };
    const replies = [planOutput({ files })];
    const backend: Backend = {
      name: "claude",
      run: async () => {
        const reply = replies.shift();
        if (reply === undefined) throw new UserError("API error (529): overloaded");
        return reply;
      },
    };
    const ui = fakePrompter([]);
    const code = await main(["node", "bae", "plan", "--yes"], cwd, {
      prompter: ui.prompter,
      createBackend: () => backend,
      env: {},
      print: () => {},
    });
    expect(code).toBe(0);
    expect(ui.log).toContain(
      "warn: The request to fix the cited paths failed, so the plan keeps them as they are: API error (529): overloaded",
    );
    expect(await exists(cwd, "docs/plan/02-architecture.md")).toBe(true);
    expect(JSON.parse(await read(cwd, ".bae/tmp/plan-report.json"))).toMatchObject({
      ok: true,
      unverifiedPaths: ["`src/routes/user.ts` in docs/plan/02-architecture.md"],
    });
  });

  it("lists paths that stay unverified in the summary and the report", async () => {
    const cwd = await setup();
    const architecture = "Routes live in `src/routes/user.ts`.";
    const files = { ...defaultFiles(), "docs/plan/02-architecture.md": architecture };
    const same = `<<<FILE: docs/plan/02-architecture.md>>>\n${architecture}\n<<<END FILE>>>`;
    const { code, ui } = await runPlan(cwd, ["--yes"], [planOutput({ files }), same]);
    expect(code).toBe(0);
    expect(ui.log.join("\n")).toContain(
      "Unverified paths (not in the repository and not marked new):\n- `src/routes/user.ts` in docs/plan/02-architecture.md",
    );
    expect(JSON.parse(await read(cwd, ".bae/tmp/plan-report.json"))).toMatchObject({
      evidenceRetries: 1,
      unverifiedPaths: ["`src/routes/user.ts` in docs/plan/02-architecture.md"],
    });
    expect(await read(cwd, "docs/plan/02-architecture.md")).toBe(`${architecture}\n`);
  });

  it("asks only blocking questions and saves every question to the interview", async () => {
    const cwd = await setup();
    const questions = JSON.stringify([
      { question: "Which DB?", why: "schema", options: ["sqlite", "postgres"], blocking: true },
      { question: "Product name?", why: "branding" },
    ]);
    const { code, ui, ai } = await runPlan(
      cwd,
      [],
      [planOutput({ questions })],
      ["all", "option-1", false],
    );
    expect(code).toBe(0);
    expect(ai.prompts).toHaveLength(1);
    expect(ui.asked).toEqual([
      "Write 7 file(s)?",
      "Which DB?",
      "You answered blocking questions. Run the plan again now with your answers?",
    ]);
    expect(ui.log.join("\n")).toContain("1. Product name? — branding");
    const interview = await read(cwd, ".bae/interview.md");
    expect(interview).toMatch(
      /^# Interview\n\nAdd team accounts\.\n\n## Questions from the plan \(\d{4}-\d{2}-\d{2}\)/,
    );
    expect(interview).toContain(
      "### Which DB?\n\n- Why: schema\n- Options: sqlite / postgres\n- Blocking: the plan assumed an answer\n- Answer: postgres",
    );
    expect(interview).toContain(
      "### Product name?\n\n- Why: branding\n- Answer: _open, not answered yet_",
    );
    expect(ui.log.at(-1)).toBe(
      "outro: 7 file(s) written. Next: npx builder-assistant-engineer next",
    );
  });

  it("plans again right away with the answers and drops tasks the new plan no longer has", async () => {
    const cwd = await setup();
    const questions = '[{"question": "Which DB?", "why": "schema", "blocking": true}]';
    const smaller = {
      "AGENTS.md": "# Project",
      "docs/plan/tasks/T-001-setup-baseline.md": taskFile("T-001"),
      ".claude/agents/reviewer.md": "---\nname: reviewer\ndescription: Reviews tasks\n---\nReview.",
    };
    const { code, ai, ui } = await runPlan(
      cwd,
      [],
      [planOutput({ questions }), planOutput({ files: smaller })],
      ["all", "postgres", true, "all"],
    );
    expect(code).toBe(0);
    expect(ai.prompts).toHaveLength(2);
    expect(ai.prompts[1]).toContain("### Which DB?");
    expect(ai.prompts[1]).toContain("- Answer: postgres");
    expect(ui.log).toContain("outro: Running the plan again with your answers.");
    expect(await exists(cwd, "docs/plan/tasks/T-002-add-feature.md")).toBe(false);
    expect(await exists(cwd, "docs/plan/tasks/T-001-setup-baseline.md")).toBe(true);
  });

  it("does not ask with --yes and keeps blocking questions open", async () => {
    const cwd = await setup();
    const questions = '[{"question": "Which DB?", "why": "schema", "blocking": true}]';
    const { ui } = await runPlan(cwd, ["--yes"], [planOutput({ questions })]);
    expect(ui.asked).toEqual([]);
    expect(ui.log).toContain("info: 1 question(s) saved to .bae/interview.md.");
    expect(await read(cwd, ".bae/interview.md")).toContain("- Answer: _open, not answered yet_");
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

  it("repairs loose markers and a missing final END FILE locally instead of asking again", async () => {
    const cwd = await setup();
    const answer = planOutput()
      .replace("<<<END SUMMARY>>>", "<<< end summary >>>")
      .replace(/<<<END FILE>>>$/, "");
    const prompts: string[] = [];
    const backend: Backend = {
      name: "claude",
      run: async (prompt, options) => {
        prompts.push(prompt);
        options.onInfo?.({ truncated: false });
        return answer;
      },
    };
    const ui = fakePrompter([]);
    const code = await main(["node", "bae", "plan", "--yes"], cwd, {
      prompter: ui.prompter,
      createBackend: () => backend,
      env: {},
      print: () => {},
    });
    expect(code).toBe(0);
    expect(prompts).toHaveLength(1);
    expect(await exists(cwd, ".claude/commands/next.md")).toBe(true);
    const report = JSON.parse(await read(cwd, ".bae/tmp/plan-report.json"));
    expect(report).toMatchObject({ formatRetries: 0, continuations: 0 });
    expect(report.repairs).toEqual([
      "normalized 1 marker(s) with extra spaces or lowercase",
      "closed the last FILE block (.claude/commands/next.md) that was missing <<<END FILE>>>",
    ]);
    expect(ui.log.join("\n")).toContain("info: Repaired the answer locally:");
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
