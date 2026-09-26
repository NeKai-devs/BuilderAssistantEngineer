import { describe, expect, it } from "vitest";
import { selectFiles } from "../../src/plan/filter.js";
import { defaultFiles } from "../plan-sample.js";

const files = Object.entries({ ...defaultFiles(), "GEMINI.md": "@AGENTS.md" }).map(
  ([path, content]) => ({ path, content }),
);
const paths = (selected: { path: string }[]) => selected.map((file) => file.path);

describe("selectFiles", () => {
  it("drops formats for agents that are not targeted", () => {
    expect(paths(selectFiles(files, { targets: ["codex"] }))).toEqual([
      "AGENTS.md",
      "docs/plan/00-overview.md",
      "docs/plan/tasks/T-001-setup-baseline.md",
      "docs/plan/tasks/T-002-add-feature.md",
    ]);
  });

  it("keeps only the requested group", () => {
    const targets = ["claude-code", "opencode", "gemini"] as const;
    expect(paths(selectFiles(files, { only: "memory", targets: [...targets] }))).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
    ]);
    expect(paths(selectFiles(files, { only: "agents", targets: [...targets] }))).toEqual([
      ".claude/agents/reviewer.md",
      ".opencode/agent/reviewer.md",
      ".claude/commands/next.md",
    ]);
  });
});
