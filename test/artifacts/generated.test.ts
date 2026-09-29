import { describe, expect, it } from "vitest";
import { opencodeAgent, withGeneratedFiles } from "../../src/artifacts/generated.js";

const reviewer = [
  "---",
  "name: reviewer",
  "description: Checks a task against its criteria",
  "tools: Read, Grep, Glob, Bash",
  "model: inherit",
  "---",
  "You review; you never edit files.",
  "",
].join("\n");

describe("files bae writes instead of asking the AI (audit, cost)", () => {
  it("converts each Claude Code subagent for opencode, keeping its limits", () => {
    expect(opencodeAgent(reviewer)).toBe(
      [
        "---",
        "description: Checks a task against its criteria",
        "mode: subagent",
        "tools:",
        "  write: false",
        "  edit: false",
        "---",
        "You review; you never edit files.",
        "",
      ].join("\n"),
    );
    const writer = reviewer.replace("tools: Read, Grep, Glob, Bash", "tools: Read, Edit, Write");
    expect(opencodeAgent(writer)).toContain("tools:\n  bash: false\n");
    expect(opencodeAgent(reviewer.replace("tools: Read, Grep, Glob, Bash\n", ""))).not.toContain(
      "tools:",
    );
  });

  it("replaces commands the AI wrote with fixed templates that never mark a task done", () => {
    const files = withGeneratedFiles([
      { path: ".claude/agents/reviewer.md", content: reviewer },
      { path: ".claude/commands/next.md", content: "Pick a task and set status: done." },
      { path: ".opencode/command/ship.md", content: "Ship it." },
    ]);
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/commands/next.md",
      ".claude/commands/review.md",
      ".claude/commands/status.md",
      ".opencode/agent/reviewer.md",
      ".opencode/command/next.md",
      ".opencode/command/review.md",
      ".opencode/command/status.md",
    ]);
    const next = files.find((file) => file.path === ".claude/commands/next.md")?.content ?? "";
    expect(next).toContain("npx builder-assistant-engineer next");
    expect(next).toContain("Never change `status:` in a task file.");
    expect(next).not.toContain("status: done");
  });
});
