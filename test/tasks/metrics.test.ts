import { describe, expect, it } from "vitest";
import { planContext } from "../../src/tasks/handoff.js";
import { formatDuration } from "../../src/tasks/metrics.js";
import { parseTask } from "../../src/tasks/schema.js";
import { taskFile } from "../plan-sample.js";

describe("formatDuration", () => {
  it("uses seconds, minutes or hours", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(12 * 60_000)).toBe("12m");
    expect(formatDuration(125 * 60_000)).toBe("2h 5m");
  });
});

describe("planContext", () => {
  it("lists the most recently finished notes first", () => {
    const done = (id: string) =>
      parseTask(`docs/plan/tasks/${id}-x.md`, taskFile(id, { status: "done", log: `Note ${id}.` }));
    const current = parseTask("docs/plan/tasks/T-005-x.md", taskFile("T-005"));
    const tasks = [done("T-001"), done("T-002"), done("T-003"), done("T-004"), current];
    const finished = new Map([
      ["T-001", 4],
      ["T-002", 3],
      ["T-003", 2],
      ["T-004", 1],
    ]);
    const config = {
      version: 1 as const,
      mode: "brownfield" as const,
      backend: "claude" as const,
      targets: ["claude-code" as const],
      lang: "en" as const,
      digest: { maxChars: 1 },
      commands: {},
      gates: { regression: "full" as const },
      verify: { allow: [] },
      agent: { timeoutMinutes: 45 },
    };
    const text = planContext(config, tasks, current, finished);
    expect(text.indexOf("Note T-001.")).toBeLessThan(text.indexOf("Note T-002."));
    expect(text).not.toContain("Note T-004.");
    expect(text).not.toContain("## Project commands");
  });
});
