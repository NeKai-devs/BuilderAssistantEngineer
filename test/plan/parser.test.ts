import { describe, expect, it } from "vitest";
import { FormatError } from "../../src/core/errors.js";
import { parsePlan } from "../../src/plan/parser.js";
import { defaultFiles, planOutput, taskFile } from "../plan-sample.js";

function problemsOf(text: string, options = {}): string {
  try {
    parsePlan(text, options);
  } catch (error) {
    if (error instanceof FormatError) return error.message;
    throw error;
  }
  throw new Error("expected a FormatError");
}

describe("parsePlan", () => {
  it("parses summary, questions, files and tasks", () => {
    const questions =
      '[{"question": "Which DB?", "why": "data model", "options": ["sqlite", "postgres"], "blocking": true}]';
    const plan = parsePlan(planOutput({ summary: "Line one\nLine two", questions }), {
      requireReviewer: true,
    });
    expect(plan.summary).toBe("Line one\nLine two");
    expect(plan.questions).toEqual([
      { question: "Which DB?", why: "data model", options: ["sqlite", "postgres"], blocking: true },
    ]);
    expect(plan.files.map((file) => file.path)).toEqual(Object.keys(defaultFiles()));
    expect(plan.files[0]?.content).toBe("# Project\n\nRun npm test.\n");
    expect(plan.tasks.map((task) => task.meta.id)).toEqual(["T-001", "T-002"]);
    expect(plan.warnings).toEqual([]);
  });

  it("only treats markers at the start of a line as markers", () => {
    const files = {
      "AGENTS.md":
        "Output uses `<<<FILE: path>>>` blocks.\nEach ends with <<<END FILE>>> on its own line.",
    };
    const plan = parsePlan(planOutput({ files }));
    expect(plan.files[0]?.content).toContain("`<<<FILE: path>>>` blocks.");
    expect(plan.files[0]?.content).toContain("ends with <<<END FILE>>> on its own line.");
  });

  it("reads the project commands from the CONFIG block and drops nulls", () => {
    const config =
      '{"commands": {"test": "npm test", "lint": " npm run lint ", "typecheck": null}}';
    const plan = parsePlan(planOutput({ config }));
    expect(plan.commands).toEqual({ test: "npm test", lint: "npm run lint" });
    expect(parsePlan(planOutput()).commands).toEqual({});
  });

  it("ignores an invalid CONFIG block with a warning instead of failing", () => {
    const plan = parsePlan(planOutput({ config: "{nope" }));
    expect(plan.commands).toEqual({});
    expect(plan.warnings).toEqual(["ignored the CONFIG block: it is not valid JSON"]);
  });

  it("tolerates chatter outside the blocks with a warning and fenced JSON questions", () => {
    const text = `Sure, here is the plan:\n${planOutput({ questions: "```json\n[]\n```" })}\nDone!`;
    const plan = parsePlan(text);
    expect(plan.questions).toEqual([]);
    expect(plan.warnings).toEqual(["ignored 28 characters outside the output blocks"]);
  });

  it.each([
    [
      "a missing summary",
      planOutput().replace(/<<<SUMMARY>>>[\s\S]*?<<<END SUMMARY>>>/, ""),
      "expected exactly one SUMMARY block, found 0",
    ],
    ["an unclosed file", planOutput().replace(/<<<END FILE>>>$/, ""), "missing <<<END FILE>>>"],
    [
      "a nested marker",
      planOutput().replace("<<<END SUMMARY>>>", "<<<QUESTIONS>>>"),
      "opened before <<<END SUMMARY>>>",
    ],
    [
      "invalid questions JSON",
      planOutput({ questions: "[{question: 1}]" }),
      "QUESTIONS is not valid JSON",
    ],
    [
      "too many questions",
      planOutput({ questions: JSON.stringify(Array(6).fill({ question: "q" })) }),
      "QUESTIONS does not match",
    ],
  ])("rejects %s", (_, text, problem) => {
    expect(problemsOf(text)).toContain(problem);
  });

  it("rejects unsafe or unexpected paths, duplicates and a missing AGENTS.md", () => {
    const files = {
      "../evil.md": "x",
      "/etc/passwd.md": "x",
      "package.json": "{}",
      "docs/plan/a.md": "a",
    };
    const text = `${planOutput({ files })}\n<<<FILE: docs/plan/a.md>>>\nb\n<<<END FILE>>>`;
    const problems = problemsOf(text);
    expect(problems).toContain('FILE path not allowed: "../evil.md"');
    expect(problems).toContain('FILE path not allowed: "/etc/passwd.md"');
    expect(problems).toContain('FILE path not allowed: "package.json"');
    expect(problems).toContain("docs/plan/a.md appears more than once");
    expect(problems).toContain("missing FILE block for AGENTS.md");
  });

  it("validates task names, ids, dependencies and cycles", () => {
    const files = {
      "AGENTS.md": "x",
      "docs/plan/tasks/setup.md": taskFile("T-001"),
      "docs/plan/tasks/T-002-a.md": taskFile("T-003"),
      "docs/plan/tasks/T-004-b.md": taskFile("T-004", { dependsOn: ["T-005", "T-009"] }),
      "docs/plan/tasks/T-005-c.md": taskFile("T-005", { dependsOn: ["T-004"] }),
    };
    const problems = problemsOf(planOutput({ files }));
    expect(problems).toContain("docs/plan/tasks/setup.md: task files must be named");
    expect(problems).toContain("frontmatter id T-003 does not match the file name");
    expect(problems).toContain("T-004 depends on unknown tasks: T-009");
    expect(problems).toContain("dependency cycle: T-004 -> T-005 -> T-004");
  });

  it("accepts dependencies on tasks that already exist on disk", () => {
    const files = {
      "AGENTS.md": "x",
      "docs/plan/tasks/T-003-c.md": taskFile("T-003", { dependsOn: ["T-001"] }),
    };
    expect(parsePlan(planOutput({ files }), { knownTaskIds: ["T-001"] }).tasks).toHaveLength(1);
  });

  it("requires a described reviewer subagent when agents are targeted", () => {
    const files = {
      "AGENTS.md": "x",
      ".claude/agents/backend.md": "---\nname: backend\n---\nBuild.",
    };
    const problems = problemsOf(planOutput({ files }), { requireReviewer: true });
    expect(problems).toContain(".claude/agents/backend.md: frontmatter must include a description");
    expect(problems).toContain("missing the reviewer subagent");
  });
});
