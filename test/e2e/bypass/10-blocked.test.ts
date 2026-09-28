import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UserError } from "../../../src/core/errors.js";
import {
  agent,
  attempts,
  bypassRepo,
  FAIL,
  LESSON,
  next,
  REVIEW_PASS,
  statusOf,
  TASK,
} from "./harness.js";

describe("bypass 10: blocked cannot be dodged by crashing or restarting", () => {
  it("counts attempts across invocations and records the ones that ended in an agent error", async () => {
    const cwd = await bypassRepo({ task: { command: FAIL } });
    const work = agent(cwd, { "src/feature.ts": "x\n" });
    const crash = async () => {
      throw new UserError("claude exited with code 1");
    };
    const first = await next(cwd, ["--headless", "--yes"], [work, crash]);
    expect(first.code).toBe(1);
    expect(await statusOf(cwd)).toBe("in_progress");
    expect((await attempts(cwd)).map((item) => [item.outcome, item.stage])).toEqual([
      ["failed", "verification"],
      ["failed", "agent"],
    ]);
    const second = await next(cwd, ["--headless", "--yes"], [work, LESSON]);
    expect(second.code).toBe(1);
    expect(second.calls.filter((call) => call.options.access === "edit")).toHaveLength(1);
    expect(await statusOf(cwd)).toBe("blocked");
  });

  it("gives a task blocked by agent errors a new budget once a person sets it back to pending", async () => {
    const cwd = await bypassRepo();
    const crash = async () => {
      throw new UserError("claude exited with code 1");
    };
    await next(cwd, ["--headless", "--yes"], [crash]);
    await next(cwd, ["--headless", "--yes"], [crash]);
    const third = await next(cwd, ["--headless", "--yes"], [crash, LESSON]);
    expect(third.code).toBe(1);
    expect(await statusOf(cwd)).toBe("blocked");
    expect((await attempts(cwd)).at(-1)?.outcome).toBe("blocked");
    const path = join(cwd, TASK);
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace("status: blocked", "status: pending"),
    );
    const again = await next(
      cwd,
      ["--headless", "--yes"],
      [agent(cwd, { "src/feature.ts": "x\n" }), REVIEW_PASS],
    );
    expect(again.code).toBe(0);
    expect(await statusOf(cwd)).toBe("done");
  });

  it("gives the headless agent the configured timeout", async () => {
    const cwd = await bypassRepo({
      task: { command: FAIL },
      config: { agent: { timeoutMinutes: 5 } },
    });
    const run = await next(
      cwd,
      ["--headless", "--yes"],
      [agent(cwd, {}), agent(cwd, {}), agent(cwd, {}), LESSON],
    );
    expect(run.calls[0]?.options.timeoutMs).toBe(300_000);
  });

  it("records a reviewer that never returns valid JSON as a failed attempt instead of crashing", async () => {
    const cwd = await bypassRepo();
    const run = await next(
      cwd,
      ["--yes"],
      [agent(cwd, { "src/feature.ts": "x\n" }), () => "nope", () => "still no"],
    );
    expect(run.code).toBe(1);
    expect(run.log).toContain("The reviewer could not give a verdict");
    const [only] = await attempts(cwd);
    expect([only.outcome, only.stage]).toEqual(["failed", "review"]);
    expect(await statusOf(cwd)).toBe("in_progress");
  });
});
