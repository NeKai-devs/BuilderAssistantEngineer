import { describe, expect, it } from "vitest";
import { planProgress } from "../../src/plan/progress.js";

describe("planProgress", () => {
  it("names each plan file once as it arrives, even when a marker is split", () => {
    const shown: string[] = [];
    const tracker = planProgress("claude", (message) => shown.push(message));
    tracker.onProgress({ type: "tool", tool: "Read", detail: "src/app.ts" });
    tracker.onProgress({ type: "text", text: "<<<SUMMARY>>>\nA plan.\n<<<FI" });
    tracker.onProgress({ type: "text", text: "LE: AGENTS.md>>>\n# Rules\n<<<END FILE>>>\n" });
    tracker.stream("<<<FILE: AGENTS.md>>>\n<<<FILE: docs/plan/tasks/T-001-a.md>>>\n");
    tracker.onProgress({ type: "thinking" });
    expect(shown).toEqual([
      "claude is writing the plan (10–40 min) · reading src/app.ts",
      "claude is writing the plan (10–40 min) · 1 file(s) · AGENTS.md",
      "claude is writing the plan (10–40 min) · 2 file(s) · docs/plan/tasks/T-001-a.md",
    ]);
    expect(tracker.files()).toBe(2);
  });
});
