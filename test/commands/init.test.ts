import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { readConfig } from "../../src/config/store.js";
import { fakeBackend, fakePrompter } from "../fakes.js";
import { copyFixture, tempDir, writeFiles } from "../helpers.js";

const read = (cwd: string, path: string) => readFile(join(cwd, path), "utf8");
const exists = (cwd: string, path: string) =>
  read(cwd, path).then(
    () => true,
    () => false,
  );

async function runInit(cwd: string, args: string[], answers: unknown[], replies: string[] = []) {
  const ui = fakePrompter(answers);
  const ai = fakeBackend(replies);
  const printed: string[] = [];
  const code = await main(["node", "bae", "init", ...args], cwd, {
    prompter: ui.prompter,
    createBackend: () => ai.backend,
    env: { PATH: await tempDir() },
    print: (text) => printed.push(text),
  });
  return { code, ui, ai, printed: printed.join("") };
}

describe("init", () => {
  it("writes config, interview and gitignore entries non-interactively with --yes", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, { "brief.md": "A habit tracker for small teams." });
    const { code, ui } = await runInit(cwd, ["--yes", "--lang", "es", "--brief", "brief.md"], []);
    expect(code).toBe(0);
    expect(ui.asked).toEqual([]);
    expect(await readConfig(cwd)).toEqual({
      version: 1,
      mode: "greenfield",
      backend: "manual",
      targets: ["claude-code"],
      lang: "es",
      digest: { maxChars: 100_000 },
      commands: {},
      gates: { regression: "full" },
    });
    const interview = await read(cwd, ".bae/interview.md");
    expect(interview).toContain("# Entrevista");
    expect(interview).toContain("- Modo: greenfield");
    expect(interview).toContain("A habit tracker for small teams.");
    expect(await read(cwd, ".gitignore")).toBe(".bae/tmp/\n");
  });

  it("runs the full interview with an adaptive follow-up on a brownfield repo", async () => {
    const cwd = await copyFixture("node-app");
    await writeFiles(cwd, { "docs/brief.md": "Add team accounts." });
    const answers = [
      "en",
      "brownfield",
      "claude",
      ["claude-code", "opencode"],
      "docs/brief.md",
      "feature",
      "Team accounts for the API",
      "",
      "Invites and roles only",
      "Keep Express",
      "AI only",
      "Do not touch src/routes/users.ts",
      "option-1",
    ];
    const replies = [
      '{"done": false, "question": "Which auth provider?", "why": "Changes the data model", "options": ["none", "OAuth"]}',
      '{"done": true, "summary": "Team accounts on the existing Express API."}',
    ];
    const { code, ui, ai } = await runInit(cwd, [], answers, replies);
    expect(code).toBe(0);
    expect(ui.remaining()).toBe(0);
    expect(await readConfig(cwd)).toMatchObject({
      mode: "brownfield",
      backend: "claude",
      targets: ["claude-code", "opencode"],
    });
    expect(ai.prompts).toHaveLength(2);
    expect(ai.prompts[0]).toContain("- MODE: INTERVIEW");
    expect(ai.prompts[0]).toContain("- CAN_EXPLORE_REPO: true");
    expect(ai.prompts[0]).toContain("# Repository digest");
    expect(ai.prompts[0]).toContain("Add team accounts.");
    expect(ai.prompts[1]).toContain("Which auth provider?");

    const interview = await read(cwd, ".bae/interview.md");
    expect(interview).toContain("- Goal: Build a new feature");
    expect(interview).toContain(
      "## What do you want to build, and for whom?\n\nTeam accounts for the API",
    );
    expect(interview).toContain(
      "## What problem does it solve, and how will you know it works?\n\n_skipped_",
    );
    expect(interview).toContain("### Which auth provider?\n\nOAuth");
    expect(interview).toContain("## Summary\n\nTeam accounts on the existing Express API.");
  });

  it("keeps going when the analyst fails and asks to fix a malformed reply once", async () => {
    const cwd = await tempDir();
    const answers = ["en", "greenfield", "claude", ["claude-code"], "", "", "", "", "", "", ""];
    const replies = ["not json", '{"done": true, "summary": "Fixed."}'];
    const { code, ui, ai } = await runInit(cwd, [], answers, replies);
    expect(code).toBe(0);
    expect(ui.log).toContain(
      "warn: The answer did not follow the output format; asking once more to fix only the format.",
    );
    expect(ai.prompts[1]).toContain("<previous_response>\nnot json\n</previous_response>");
    expect(await read(cwd, ".bae/interview.md")).toContain("Fixed.");
  });

  it("prints the interview prompt on --dry-run and writes nothing", async () => {
    const cwd = await tempDir();
    const answers = [
      "en",
      "greenfield",
      "claude",
      ["claude-code"],
      "a todo app",
      "",
      "",
      "",
      "",
      "",
      "",
    ];
    const { code, ai, printed } = await runInit(cwd, ["--dry-run"], answers);
    expect(code).toBe(0);
    expect(ai.prompts).toEqual([]);
    expect(printed).toContain("- MODE: INTERVIEW");
    expect(printed).toContain("a todo app");
    expect(await exists(cwd, ".bae/config.json")).toBe(false);
    expect(await exists(cwd, ".gitignore")).toBe(false);
  });

  it("keeps an existing interview unless asked to redo it", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, { ".bae/interview.md": "# Old interview\n" });
    const { code } = await runInit(cwd, ["--yes", "--backend", "codex"], []);
    expect(code).toBe(0);
    expect(await read(cwd, ".bae/interview.md")).toBe("# Old interview\n");
    expect((await readConfig(cwd))?.backend).toBe("codex");
  });

  it("fails clearly when the brief file does not exist", async () => {
    const cwd = await tempDir();
    const { code } = await runInit(cwd, ["--yes", "--brief", "missing.md"], []);
    expect(code).toBe(1);
    expect(await exists(cwd, ".bae/config.json")).toBe(false);
  });
});
