import { describe, expect, it } from "vitest";
import { extractCitations, formatRatio, measurePlan, sumRatios } from "../scripts/eval/metrics.js";
import { tempDir, writeFiles } from "./helpers.js";
import { taskFile } from "./plan-sample.js";

describe("eval metrics", () => {
  it("extracts path citations and ignores commands, packages, domains and globs", () => {
    const text =
      "See `main.go:6`, `internal/handler/handler.go:3-5`, `src/`, `package.json` and `.env`. " +
      "Not `go test ./...`, `github.com/gin-gonic/gin`, `v1.12.0`, `T-001`, `node:path`, `src/**/*.ts` or `https://x.dev/a`.";
    expect(extractCitations(text)).toEqual([
      { path: "main.go", line: 6 },
      { path: "internal/handler/handler.go", line: 3, endLine: 5 },
      { path: "src" },
      { path: "package.json" },
      { path: ".env" },
    ]);
  });

  it("measures verification coverage and whether cited paths and lines exist", async () => {
    const repo = await tempDir();
    await writeFiles(repo, {
      "main.go": "package main\n\nfunc main() {}\n",
      "internal/a.go": "x\n",
    });
    const files = [
      {
        path: "AGENTS.md",
        text: "`main.go:3` `main.go:40` `internal/a.go` `src/new.ts` `main.go:3`",
      },
      { path: "docs/plan/tasks/T-001-a.md", text: taskFile("T-001") },
      {
        path: "docs/plan/tasks/T-002-b.md",
        text: taskFile("T-002").replace("```sh\nnpm test\n```", "none"),
      },
    ];
    expect(await measurePlan(repo, files)).toEqual({
      tasks: 2,
      tasksWithVerification: { hits: 1, total: 2 },
      lineRefs: { hits: 1, total: 2 },
      paths: { hits: 2, total: 4 },
      claims: { hits: 0, total: 0 },
      testsRequired: { hits: 0, total: 2 },
      tasksWithLog: { hits: 2, total: 2 },
    });
  });

  it("counts existence claims in architecture, ADRs and task Context", async () => {
    const repo = await tempDir();
    await writeFiles(repo, { "main.go": "package main\n" });
    const context = taskFile("T-001", { tests: "required", log: "Done." }).replace(
      "Read AGENTS.md.",
      "Read `main.go:1` and `internal/ghost.go`.",
    );
    const files = [
      { path: "docs/plan/02-architecture.md", text: "`main.go` and `cmd/new.go` (new)." },
      { path: "docs/plan/tasks/T-001-a.md", text: context },
    ];
    expect(await measurePlan(repo, files)).toMatchObject({
      claims: { hits: 1, total: 2 },
      testsRequired: { hits: 1, total: 1 },
      tasksWithLog: { hits: 0, total: 1 },
    });
  });

  it("formats and sums ratios", () => {
    expect(formatRatio({ hits: 1, total: 3 })).toBe("1/3 (33%)");
    expect(formatRatio({ hits: 0, total: 0 })).toBe("n/a");
    expect(
      sumRatios([
        { hits: 1, total: 2 },
        { hits: 3, total: 4 },
      ]),
    ).toEqual({ hits: 4, total: 6 });
  });
});
