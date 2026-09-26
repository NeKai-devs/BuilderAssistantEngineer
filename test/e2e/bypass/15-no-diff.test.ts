import { describe, expect, it } from "vitest";
import { bypassRepo, handoff, next } from "./harness.js";

describe("bypass 15: a task with nothing to change can still be done", () => {
  it("passes a task whose checks pass without changing files, and skips the reviewer", async () => {
    const cwd = await bypassRepo({
      task: { command: "test -f README.md" },
      files: { "README.md": "# Project\n" },
    });
    const run = await next(cwd, ["--yes"], [() => handoff(cwd).then(() => "")]);
    expect(run.code).toBe(0);
    expect(run.calls).toHaveLength(1);
    expect(run.log).toContain(
      "The task changed no files and its checks pass, so the reviewer was not called.",
    );
  });

  it("still fails a tests: required task that changed nothing", async () => {
    const cwd = await bypassRepo({
      task: { command: "test -f README.md", tests: "required" },
      files: { "README.md": "# Project\n" },
    });
    const run = await next(cwd, ["--yes"], [() => handoff(cwd).then(() => "")]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("The task requires tests (tests: required)");
  });
});
