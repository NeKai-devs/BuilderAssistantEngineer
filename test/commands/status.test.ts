import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { runFile, tempDir, writeFiles } from "../helpers.js";
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

  it("adds local metrics from the attempts recorded outside the repository", async () => {
    const cwd = await tempDir();
    const attempt = (outcome: string, durationMs: number, stage?: string) =>
      JSON.stringify({
        startedAt: "2026-09-26T10:00:00.000Z",
        durationMs,
        headless: true,
        outcome,
        ...(stage ? { stage } : {}),
        regressions: stage === "regression" ? ["test"] : [],
      });
    await writeFiles(cwd, {
      "docs/plan/tasks/T-001-a.md": taskFile("T-001", { status: "done", title: "First" }),
      "docs/plan/tasks/T-002-b.md": taskFile("T-002", { status: "done", title: "Second" }),
      "docs/plan/tasks/T-003-c.md": taskFile("T-003", { status: "in_progress", title: "Third" }),
      "docs/plan/tasks/T-004-d.md": taskFile("T-004", { title: "Fourth" }),
    });
    await writeFiles(runFile(cwd, ""), {
      "T-001/attempts.jsonl": `${attempt("failed", 60_000, "regression")}\n${attempt("done", 120_000)}\n`,
      "T-002/attempts.jsonl": `${attempt("done", 30_000)}\nnot json\n`,
      "T-003/attempts.jsonl": `${attempt("failed", 45_000, "review")}\n`,
    });
    const printed: string[] = [];
    await main(["node", "bae", "status"], cwd, { print: (text) => printed.push(text) });
    const output = stripVTControlCharacters(printed.join(""));
    expect(output).toContain("✔ T-001  S  low     First  2 attempt(s), 3m");
    expect(output).toContain("▶ T-003  S  low     Third  in_progress  1 attempt(s), 45s");
    expect(output).toContain("○ T-004  S  low     Fourth  pending\n");
    expect(output).toContain(
      [
        "Local metrics",
        "  attempts: 4 over 3 task(s), 1.3 per task",
        "  done on the first attempt: 1/3 (33%)",
        "  regressions caught: 1",
        "  time per done task: 2m on average, 4m in total",
      ].join("\n"),
    );
  });
});
