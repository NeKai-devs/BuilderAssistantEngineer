import { describe, expect, it } from "vitest";
import { FormatError } from "../../src/core/errors.js";
import { setFrontmatterFields, splitFrontmatter } from "../../src/tasks/frontmatter.js";
import { findCycle } from "../../src/tasks/graph.js";
import {
  parseTask,
  sectionText,
  taskProblems,
  verificationCommands,
} from "../../src/tasks/schema.js";
import { taskFile } from "../plan-sample.js";

describe("task files", () => {
  it("parses frontmatter and normalizes depends_on and phase", () => {
    const task = parseTask(
      "docs/plan/tasks/T-002-x.md",
      taskFile("T-002", { dependsOn: ["T-001"] }),
    );
    expect(task.meta).toEqual({
      id: "T-002",
      title: "Do T-002",
      status: "pending",
      phase: 1,
      depends_on: ["T-001"],
      size: "S",
      risk: "low",
    });
    expect(taskProblems(task)).toEqual([]);
  });

  it("reports invalid or missing frontmatter as a format error", () => {
    expect(() => parseTask("t.md", "# no frontmatter")).toThrow(FormatError);
    expect(() => parseTask("t.md", taskFile("T-1"))).toThrow(/id: must look like T-001/);
    expect(() => parseTask("t.md", taskFile("T-001", { status: "started" }))).toThrow(/status/);
  });

  it("extracts sh commands from Verification, skipping comments and prompts", () => {
    const body =
      "## Verification\n```sh\n# lint first\n$ npm run lint\nnpm test\n```\n```bash\ncurl -f localhost:3000\n```\n## Risks and notes\n```sh\nnot-this\n```";
    expect(verificationCommands(body)).toEqual([
      "npm run lint",
      "npm test",
      "curl -f localhost:3000",
    ]);
  });

  it("accepts Spanish section headings", () => {
    const body = "## Objetivo\nx\n## Verificación\n```sh\nnpm test\n```";
    expect(sectionText(body, "goal")).toBe("x");
    expect(verificationCommands(body)).toEqual(["npm test"]);
  });

  it("lists missing sections and verification without commands", () => {
    const text = taskFile("T-003")
      .replace("## Steps\n1. Do it.\n", "")
      .replace("```sh\nnpm test\n```\n", "");
    expect(taskProblems(parseTask("docs/plan/tasks/T-003-x.md", text))).toEqual([
      'docs/plan/tasks/T-003-x.md: missing section "steps"',
      "docs/plan/tasks/T-003-x.md: Verification needs at least one command in a ```sh block",
    ]);
  });

  it("updates frontmatter fields without touching the body", () => {
    const updated = setFrontmatterFields(taskFile("T-001"), { status: "done" });
    expect(splitFrontmatter(updated)?.data.status).toBe("done");
    expect(updated).toContain("depends_on: []");
    expect(updated.endsWith("None.\n")).toBe(true);
  });

  it("reads frontmatter that is not strict YAML, like colons inside values", () => {
    const text =
      "---\nname: reviewer\ndescription: No escribe código: sólo verifica.\ntools: Read, Grep\n---\nBody";
    expect(splitFrontmatter(text)?.data).toEqual({
      name: "reviewer",
      description: "No escribe código: sólo verifica.",
      tools: "Read, Grep",
    });
    const task = taskFile("T-004", {
      title: "Users: list and create",
      dependsOn: ["T-002", "T-003"],
    });
    expect(parseTask("docs/plan/tasks/T-004-users.md", task).meta).toMatchObject({
      title: "Users: list and create",
      depends_on: ["T-002", "T-003"],
      phase: 1,
    });
  });

  it("updates a field line even when the frontmatter is not strict YAML", () => {
    const task = taskFile("T-004", { title: "Users: list and create" });
    const updated = setFrontmatterFields(task, { status: "in_progress" });
    expect(updated).toContain("title: Users: list and create\nstatus: in_progress\nphase: 1");
  });

  it("finds dependency cycles", () => {
    expect(
      findCycle([
        { id: "A", dependsOn: ["B"] },
        { id: "B", dependsOn: [] },
      ]),
    ).toBeUndefined();
    expect(
      findCycle([
        { id: "A", dependsOn: ["B"] },
        { id: "B", dependsOn: ["C"] },
        { id: "C", dependsOn: ["A"] },
      ]),
    ).toEqual(["A", "B", "C", "A"]);
  });
});
