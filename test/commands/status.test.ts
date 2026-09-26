import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { tempDir, writeFiles } from "../helpers.js";
import { taskFile } from "../plan-sample.js";

describe("status", () => {
  it("shows phases, task states, waiting dependencies and the next task", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, {
      "docs/plan/tasks/T-001-a.md": taskFile("T-001", {
        status: "done",
        title: "Set up the baseline",
      }),
      "docs/plan/tasks/T-002-b.md": taskFile("T-002", {
        dependsOn: ["T-001"],
        title: "Add health",
      }),
      "docs/plan/tasks/T-003-c.md": taskFile("T-003", { dependsOn: ["T-002"], title: "Add users" }),
      "docs/plan/tasks/T-004-d.md": "no frontmatter",
    });
    const printed: string[] = [];
    const code = await main(["node", "bae", "status"], cwd, {
      print: (text) => printed.push(text),
    });
    const output = stripVTControlCharacters(printed.join(""));
    expect(code).toBe(0);
    expect(output).toContain("Phase 1");
    expect(output).toContain("1/3");
    expect(output).toContain("✔ T-001  S  low     Set up the baseline");
    expect(output).toContain("○ T-003  S  low     Add users  pending  waiting on T-002");
    expect(output).toContain("docs/plan/tasks/T-004-d.md: missing YAML frontmatter");
    expect(output).toContain("1/3 done (33%) · next: T-002 Add health");
  });
});
