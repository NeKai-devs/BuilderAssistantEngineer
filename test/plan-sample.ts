export type TaskOptions = {
  title?: string;
  dependsOn?: string[];
  status?: string;
  command?: string;
};

export function taskFile(id: string, options: TaskOptions = {}): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${options.title ?? `Do ${id}`}`,
    `status: ${options.status ?? "pending"}`,
    "phase: 1",
    `depends_on: [${(options.dependsOn ?? []).join(", ")}]`,
    "size: S",
    "risk: low",
    "---",
    "## Goal",
    `Goal of ${id}.`,
    "## Context",
    "Read AGENTS.md.",
    "## Scope",
    "src/ only.",
    "## Steps",
    "1. Do it.",
    "## Acceptance criteria",
    "- [ ] It works.",
    "## Verification",
    "```sh",
    options.command ?? "npm test",
    "```",
    "Tests pass.",
    "## Risks and notes",
    "None.",
    "",
  ].join("\n");
}

export function defaultFiles(): Record<string, string> {
  return {
    "AGENTS.md": "# Project\n\nRun npm test.",
    "CLAUDE.md": "@AGENTS.md\n\nPrefer small commits.",
    "docs/plan/00-overview.md": "# Overview",
    "docs/plan/tasks/T-001-setup-baseline.md": taskFile("T-001"),
    "docs/plan/tasks/T-002-add-feature.md": taskFile("T-002", { dependsOn: ["T-001"] }),
    ".claude/agents/reviewer.md": "---\nname: reviewer\ndescription: Reviews tasks\n---\nReview.",
    ".opencode/agent/reviewer.md": "---\ndescription: Reviews tasks\nmode: subagent\n---\nReview.",
    ".claude/commands/next.md": "Run the next task.",
  };
}

export function planOutput(
  parts: { summary?: string; questions?: string; files?: Record<string, string> } = {},
): string {
  const files = parts.files ?? defaultFiles();
  return [
    "<<<SUMMARY>>>",
    parts.summary ?? "A small plan.",
    "<<<END SUMMARY>>>",
    "<<<QUESTIONS>>>",
    parts.questions ?? "[]",
    "<<<END QUESTIONS>>>",
    ...Object.entries(files).flatMap(([path, content]) => [
      `<<<FILE: ${path}>>>`,
      content.trimEnd(),
      "<<<END FILE>>>",
    ]),
  ].join("\n");
}
