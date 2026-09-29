import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { fakePrompter, scriptedBackend } from "../fakes.js";
import { copyFixture, gitCommitAll, writeFiles } from "../helpers.js";
import { planOutput } from "../plan-sample.js";

const INTERVIEW = [
  "en",
  "brownfield",
  "claude",
  ["claude-code"],
  "docs/brief.md",
  "feature",
  "",
  "",
  "",
  "",
  "",
  "",
  "option-1",
];

describe("the cached system prompt (audit A4)", () => {
  it("is the same for init's follow-up questions and the plan that comes after them", async () => {
    const cwd = await copyFixture("node-app");
    await writeFiles(cwd, { "docs/brief.md": "Add team accounts." });
    await gitCommitAll(cwd, "chore: initial state");
    const ai = scriptedBackend([
      () =>
        '{"done": false, "question": "Which store?", "why": "Data model", "options": ["memory", "db"]}',
      () => '{"done": true, "summary": "Team accounts."}',
      () => planOutput(),
    ]);
    const run = (args: string[], answers: unknown[]) =>
      main(["node", "bae", ...args], cwd, {
        prompter: fakePrompter(answers).prompter,
        createBackend: () => ai.backend,
        env: { PATH: "" },
        print: () => {},
      });
    expect(await run(["init"], INTERVIEW)).toBe(0);
    expect(await run(["plan", "--yes"], [])).toBe(0);
    const systems = ai.calls.map((call) => call.options.system);
    expect(systems).toHaveLength(3);
    expect(systems[0]).toContain("# Repository digest");
    expect(systems[1]).toBe(systems[0]);
    expect(systems[2]).toBe(systems[0]);
  });
});
