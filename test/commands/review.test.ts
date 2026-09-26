import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { writeConfig } from "../../src/config/store.js";
import { fakeBackend, fakePrompter } from "../fakes.js";
import { gitCommitAll, tempDir, writeFiles } from "../helpers.js";
import { taskFile } from "../plan-sample.js";

async function reviewRepo() {
  const cwd = await tempDir();
  await writeConfig(cwd, {
    version: 1,
    mode: "brownfield",
    backend: "claude",
    targets: ["claude-code"],
    lang: "es",
    digest: { maxChars: 20_000 },
  });
  await writeFiles(cwd, {
    "AGENTS.md": "# Rules\nNo console.log.\n",
    ".claude/agents/reviewer.md":
      "---\nname: reviewer\ndescription: Strict reviewer\n---\nCheck everything.",
    "docs/plan/tasks/T-001-a.md": taskFile("T-001", { status: "in_progress" }),
    "src/app.js": "export const a = 1;\n",
  });
  await gitCommitAll(cwd, "base");
  await writeFiles(cwd, { "src/app.js": "console.log('hi');\n" });
  return cwd;
}

async function review(cwd: string, args: string[], reply: string) {
  const ui = fakePrompter([]);
  const ai = fakeBackend([reply]);
  const code = await main(["node", "bae", "review", ...args], cwd, {
    prompter: ui.prompter,
    createBackend: () => ai.backend,
    env: {},
    print: () => {},
  });
  return { code, ui, prompts: ai.prompts };
}

describe("review", () => {
  it("reviews the task in progress with the generated reviewer and the diff", async () => {
    const cwd = await reviewRepo();
    const { code, prompts } = await review(cwd, [], '{"verdict": "pass", "findings": []}');
    expect(code).toBe(0);
    expect(prompts[0]).toContain("Check everything.");
    expect(prompts[0]).toContain("No console.log.");
    expect(prompts[0]).toContain("+console.log('hi');");
    expect(prompts[0]).toContain("Write the findings in Spanish.");
  });

  it("exits with 1 and lists findings when the review fails", async () => {
    const cwd = await reviewRepo();
    const reply =
      '{"verdict": "fail", "findings": [{"severity": "major", "file": "src/app.js", "message": "usa console.log"}]}';
    const { code, ui } = await review(cwd, ["t-001"], reply);
    expect(code).toBe(1);
    expect(ui.log.join("\n")).toContain("- [major] src/app.js: usa console.log");
  });

  it("fails the automatic checks without calling the reviewer", async () => {
    const cwd = await reviewRepo();
    await writeFiles(cwd, { ".env": "API_TOKEN=abc\n" });
    const { code, ui, prompts } = await review(cwd, [], "");
    expect(code).toBe(1);
    expect(prompts).toEqual([]);
    expect(ui.log).toContain(
      "warn: Los chequeos automáticos fallaron, así que no se lanzó el revisor.",
    );
    expect(ui.log.join("\n")).toContain("- [blocker] .env: Parece un archivo de secretos");
  });

  it("passes the automatic findings to the reviewer", async () => {
    const cwd = await reviewRepo();
    await writeFiles(cwd, {
      "docs/plan/tasks/T-001-a.md": taskFile("T-001", { status: "in_progress", scope: "- `lib/`" }),
    });
    const { prompts } = await review(cwd, [], '{"verdict": "pass", "findings": []}');
    expect(prompts[0]).toContain(
      "<checks>\n- [major] Cambios fuera del Scope de la tarea: src/app.js",
    );
  });

  it("fails clearly for an unknown task", async () => {
    const cwd = await reviewRepo();
    const { code, prompts } = await review(cwd, ["T-009"], "");
    expect(code).toBe(1);
    expect(prompts).toEqual([]);
  });
});
