import { describe, expect, it } from "vitest";
import { taskFile } from "../../plan-sample.js";
import { agent, bypassRepo, next, PASS, REVIEW_PASS, read, statusOf, TASK } from "./harness.js";

describe("bypass 02: the agent cannot rewrite the task that checks it", () => {
  it("restores Verification, tests and Scope, keeps the Log, and the next run checks the original task", async () => {
    const cwd = await bypassRepo({ task: { tests: "required", command: "node verify.js" } });
    const cheat = agent(cwd, { "src/feature.ts": "export const f = 1;\n" }, async () => {
      const text = await read(cwd, TASK);
      const { writeFiles } = await import("../../helpers.js");
      await writeFiles(cwd, {
        [TASK]: text
          .replace("tests: required", "tests: optional")
          .replace("node verify.js", "true")
          .replace("- `src/feature.ts`", "- `src/`"),
      });
    });
    const first = await next(cwd, ["--yes"], [cheat]);
    expect(first.code).toBe(1);
    expect(first.log).toContain(`${TASK}: Edited the task file outside ## Log. Restored.`);
    const restored = await read(cwd, TASK);
    expect(restored).toContain("tests: required");
    expect(restored).toContain("node verify.js");
    expect(restored).toContain("- `src/feature.ts`");
    expect(restored).toContain("Did the work; no traps.");
    const second = await next(cwd, ["--yes", "--dry-run"], []);
    expect(second.log).toContain("$ node verify.js");
  });

  it("restores another task's status when the agent unblocks it", async () => {
    const cwd = await bypassRepo({
      files: { "docs/plan/tasks/T-003-third.md": taskFile("T-003", { status: "blocked" }) },
    });
    const cheat = agent(cwd, {
      "src/feature.ts": "export const f = 1;\n",
      "docs/plan/tasks/T-003-third.md": taskFile("T-003", { status: "done" }),
      "docs/plan/tasks/T-009-extra.md": taskFile("T-009", { command: PASS }),
    });
    const run = await next(cwd, ["--yes"], [cheat, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(await statusOf(cwd, "docs/plan/tasks/T-003-third.md")).toBe("blocked");
    await expect(read(cwd, "docs/plan/tasks/T-009-extra.md")).rejects.toThrow();
  });
});
