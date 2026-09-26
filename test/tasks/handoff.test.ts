import { describe, expect, it } from "vitest";
import { logLines, withLogSection } from "../../src/tasks/handoff.js";
import { parseTask } from "../../src/tasks/schema.js";
import { taskFile } from "../plan-sample.js";

describe("handoff note", () => {
  it("counts the non-empty lines of the Log section and ignores comments", () => {
    const text = taskFile("T-001", { log: "<!-- write here -->\n\nChanged a.\n\nTrap: b." });
    expect(logLines(parseTask("docs/plan/tasks/T-001-a.md", text))).toEqual([
      "Changed a.",
      "Trap: b.",
    ]);
  });

  it("adds a Log heading only when the task has none", () => {
    expect(withLogSection("## Goal\nx\n")).toBe("## Goal\nx\n\n## Log\n");
    expect(withLogSection("## Goal\nx\n## Registro\n")).toBe("## Goal\nx\n## Registro\n");
  });
});
