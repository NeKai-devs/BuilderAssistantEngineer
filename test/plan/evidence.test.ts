import { describe, expect, it } from "vitest";
import { describeUnverified, findUnverified } from "../../src/plan/evidence.js";
import { parsePlan } from "../../src/plan/parser.js";
import { copyFixture } from "../helpers.js";
import { defaultFiles, planOutput, taskFile } from "../plan-sample.js";

function planWith(files: Record<string, string>) {
  return parsePlan(planOutput({ files: { ...defaultFiles(), ...files } }));
}

function taskWithContext(id: string, context: string, scope = "src/ only."): string {
  return taskFile(id)
    .replace("Read AGENTS.md.", context)
    .replace("## Scope\nsrc/ only.", `## Scope\n${scope}`);
}

async function unverified(files: Record<string, string>): Promise<string[]> {
  const cwd = await copyFixture("node-app");
  return (await findUnverified(cwd, planWith(files))).map(describeUnverified);
}

describe("findUnverified", () => {
  it("accepts paths, directories, bare file names and line ranges that exist", async () => {
    const architecture = [
      "Entry point `src/index.ts:1-7` mounts `src/routes/users.ts` from `src/routes/`.",
      "Scripts live in `package.json`; tests in `users.test.ts:1` and `./test/users.test.ts:2`.",
    ].join("\n");
    expect(await unverified({ "docs/plan/02-architecture.md": architecture })).toEqual([]);
  });

  it("flags missing paths and line ranges past the end of the file", async () => {
    const architecture = "Auth lives in `src/services/auth.ts`, wired in `src/index.ts:40-90`.";
    expect(await unverified({ "docs/plan/02-architecture.md": architecture })).toEqual([
      "`src/services/auth.ts` in docs/plan/02-architecture.md",
      "`src/index.ts:40-90` in docs/plan/02-architecture.md (the file has 7 lines)",
    ]);
  });

  it("accepts paths marked (new) anywhere in the plan and the plan's own files", async () => {
    const scope = "- `src/teams/store.ts` (new)\n- `src/teams/routes.ts (new)`";
    const files = {
      "docs/plan/tasks/T-001-setup-baseline.md": taskWithContext(
        "T-001",
        "Read `src/teams/store.ts`, `src/teams/` and `docs/plan/00-overview.md`.",
        scope,
      ),
      "docs/plan/03-decisions/ADR-001-store.md": "Routes go in `src/teams/routes.ts`.",
    };
    expect(await unverified(files)).toEqual([]);
  });

  it("only checks architecture, ADRs and task Context, and skips tokens that are not paths", async () => {
    const noise = [
      "`application/json`, `app.main`, `Node.js`, `npm test`, `z.object()`,",
      "`github.com/gin-gonic/gin`, `https://example.com/a.ts`, `net/http`, `v1.2`,",
      "`express.json`, `models.py`, `dist/index.js`, `../src/app.js`.",
    ].join(" ");
    const files = {
      "docs/plan/01-prd.md": "Mentions `src/ghost.ts`.",
      "docs/plan/02-architecture.md": noise,
      "docs/plan/tasks/T-001-setup-baseline.md": taskFile("T-001").replace(
        "1. Do it.",
        "1. Create `src/ghost.ts`.",
      ),
      "docs/plan/tasks/T-002-add-feature.md": taskWithContext(
        "T-002",
        "See `lib/missing.ts` and `src/phantom/`.",
      ),
    };
    expect(await unverified(files)).toEqual([
      "`lib/missing.ts` in docs/plan/tasks/T-002-add-feature.md",
      "`src/phantom/` in docs/plan/tasks/T-002-add-feature.md",
    ]);
  });
});
