import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attempts, bypassRepo, handoff, next, read, statusOf, stops, TASK } from "./harness.js";

describe("bypass 15: a task whose agent changed nothing is never done", () => {
  it("does not run the checks when the agent only wrote its handoff note, even if they would pass", async () => {
    const cwd = await bypassRepo({
      task: { command: "test -f README.md" },
      files: { "README.md": "# Project\n" },
    });
    const run = await next(cwd, ["--yes"], [() => handoff(cwd).then(() => "")]);
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(1);
    expect(run.log).toContain(
      "The agent changed no files for T-001, so bae did not run its checks.",
    );
    expect(run.log).not.toContain("Verification passed");
    expect(await statusOf(cwd)).toBe("in_progress");
    expect(await attempts(cwd)).toEqual([]);
    expect(await stops(cwd)).toMatchObject([{ stage: "agent" }]);
  });

  it("counts an unattended agent that changed nothing as a failed attempt and does not retry it", async () => {
    const cwd = await bypassRepo({
      task: { command: "test -f README.md", tests: "required" },
      files: { "README.md": "# Project\n" },
    });
    const run = await next(cwd, ["--headless", "--yes"], [() => handoff(cwd).then(() => "")]);
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(1);
    expect(run.log).toContain("The agent changed no files for T-001");
    expect(await statusOf(cwd)).toBe("in_progress");
    expect(await attempts(cwd)).toMatchObject([{ outcome: "failed", stage: "agent" }]);
  });

  it("restores a protected file the idle agent edited, such as its own Verification", async () => {
    const cwd = await bypassRepo({
      task: { command: "test -f README.md" },
      files: { "README.md": "x\n" },
    });
    const original = await read(cwd, TASK);
    const edit = async () => {
      await writeFile(join(cwd, TASK), original.replace("test -f README.md", "true"));
      return "";
    };
    const run = await next(cwd, ["--yes"], [edit]);
    expect(run.code).toBe(1);
    expect(await read(cwd, TASK)).toContain("test -f README.md");
    expect(await statusOf(cwd)).toBe("in_progress");
  });
});
