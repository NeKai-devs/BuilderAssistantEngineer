import { describe, expect, it } from "vitest";
import { writeFiles } from "../../helpers.js";
import { bypassRepo, next, REVIEW_PASS, statusOf } from "./harness.js";

describe("bypass 16: the handoff note is a warning, not a gate", () => {
  it("finishes a task whose checks pass even when the note is missing", async () => {
    const cwd = await bypassRepo();
    const work = async () => {
      await writeFiles(cwd, { "src/feature.ts": "export const f = 1;\n" });
      return "";
    };
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(run.log).toContain("has no handoff note");
    expect(await statusOf(cwd)).toBe("done");
  });
});
