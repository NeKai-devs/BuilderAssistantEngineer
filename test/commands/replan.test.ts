import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { writeConfig } from "../../src/config/store.js";
import { fakeBackend, fakePrompter } from "../fakes.js";
import { tempDir, writeFiles } from "../helpers.js";
import { planOutput, taskFile } from "../plan-sample.js";

const read = (cwd: string, path: string) => readFile(join(cwd, path), "utf8");
const exists = (cwd: string, path: string) =>
  read(cwd, path).then(
    () => true,
    () => false,
  );

describe("replan", () => {
  it("keeps done work, updates and removes pending tasks and prepends the changelog", async () => {
    const cwd = await tempDir();
    await writeConfig(cwd, {
      version: 1,
      mode: "brownfield",
      backend: "claude",
      targets: ["codex"],
      lang: "en",
      digest: { maxChars: 20_000 },
    });
    await writeFiles(cwd, {
      "docs/plan/CHANGELOG.md": "## Initial plan\n",
      "docs/plan/04-roadmap.md": "# Roadmap v1\n",
      "docs/plan/tasks/T-001-a.md": taskFile("T-001", { status: "done", title: "Original" }),
      "docs/plan/tasks/T-002-b.md": taskFile("T-002", {
        dependsOn: ["T-001"],
        status: "in_progress",
      }),
      "docs/plan/tasks/T-003-c.md": taskFile("T-003", { dependsOn: ["T-002"] }),
    });
    const reply = planOutput({
      files: {
        "AGENTS.md": "# Project",
        "docs/plan/CHANGELOG.md": "## Replan\n\nDropped T-003, added T-004.",
        "docs/plan/tasks/T-002-b.md": taskFile("T-002", { dependsOn: ["T-001"], title: "Updated" }),
        "docs/plan/tasks/T-004-d.md": taskFile("T-004", { dependsOn: ["T-001", "T-002"] }),
      },
    });
    const ai = fakeBackend([reply]);
    const code = await main(["node", "bae", "replan", "--yes"], cwd, {
      prompter: fakePrompter([]).prompter,
      createBackend: () => ai.backend,
      env: {},
      print: () => {},
    });
    expect(code).toBe(0);
    expect(ai.prompts[0]).toContain("- T-001 [done] Original (phase 1)");
    expect(ai.prompts[0]).toContain("# Roadmap v1");
    expect(ai.prompts[0]).toContain("Pending tasks you leave out are deleted.");
    expect(await read(cwd, "docs/plan/tasks/T-001-a.md")).toContain("title: Original");
    const updated = await read(cwd, "docs/plan/tasks/T-002-b.md");
    expect(updated).toContain("title: Updated");
    expect(updated).toContain("status: in_progress");
    expect(await exists(cwd, "docs/plan/tasks/T-003-c.md")).toBe(false);
    expect(await exists(cwd, "docs/plan/tasks/T-004-d.md")).toBe(true);
    expect(await read(cwd, "docs/plan/CHANGELOG.md")).toBe(
      "## Replan\n\nDropped T-003, added T-004.\n\n## Initial plan\n",
    );
  });

  it("asks to run plan when there is no plan yet", async () => {
    const cwd = await tempDir();
    await writeConfig(cwd, {
      version: 1,
      mode: "greenfield",
      backend: "claude",
      targets: ["codex"],
      lang: "en",
      digest: { maxChars: 20_000 },
    });
    const ui = fakePrompter([]);
    const code = await main(["node", "bae", "replan"], cwd, { prompter: ui.prompter, env: {} });
    expect(code).toBe(0);
    expect(ui.log.at(-1)).toBe(
      "outro: There is no plan to update. Run npx builder-assistant-engineer plan first.",
    );
  });
});
