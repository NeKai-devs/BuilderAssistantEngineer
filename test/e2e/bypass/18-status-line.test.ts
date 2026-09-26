import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UserError } from "../../../src/core/errors.js";
import { markActive, prepareCapture, saveCapture } from "../../../src/gates/capture.js";
import { parseTask } from "../../../src/tasks/schema.js";
import { testConfig } from "../../helpers.js";
import { bypassRepo, FAIL, next, read, statusOf, TASK } from "./harness.js";

async function setStatus(cwd: string, status: string, duplicate = false) {
  const path = join(cwd, TASK);
  const text = await readFile(path, "utf8");
  const edited = duplicate
    ? text.replace(/\ntests: (\w+)\n---/, `\ntests: $1\nstatus: ${status}\n---`)
    : text.replace(/status: \w+/, `status: ${status}`);
  await writeFile(path, edited);
}

describe("bypass 18: the agent cannot set its own task's status", () => {
  it("removes a second status line instead of letting it win", async () => {
    const cwd = await bypassRepo({ task: { command: FAIL } });
    const run = await next(cwd, ["--yes"], [() => setStatus(cwd, "done", true).then(() => "")]);
    expect(run.code).toBe(1);
    expect(await statusOf(cwd)).toBe("in_progress");
    expect((await read(cwd, TASK)).match(/^status:/gm)).toHaveLength(1);
  });

  it("resets the status when the agent's CLI fails after writing done", async () => {
    const cwd = await bypassRepo({ task: { command: FAIL } });
    const crash = async () => {
      await setStatus(cwd, "done");
      throw new UserError("claude exited with code 1");
    };
    const run = await next(cwd, ["--headless", "--yes"], [crash]);
    expect(run.code).toBe(1);
    expect(await statusOf(cwd)).toBe("in_progress");
  });

  it("resets the status after a killed run before picking the next task", async () => {
    const cwd = await bypassRepo({ task: { command: FAIL } });
    const task = parseTask(TASK, await read(cwd, TASK));
    await saveCapture(cwd, await prepareCapture(cwd, testConfig(), task));
    await markActive(cwd, "T-001");
    await setStatus(cwd, "done");
    const run = await next(cwd, ["--yes", "--dry-run"], []);
    expect(await statusOf(cwd)).toBe("in_progress");
    expect(run.log).toContain("T-001 · Do T-001");
  });
});
