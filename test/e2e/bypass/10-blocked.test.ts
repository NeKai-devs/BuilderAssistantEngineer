import { describe, expect, it } from "vitest";
import { UserError } from "../../../src/core/errors.js";
import { agent, attempts, bypassRepo, FAIL, LESSON, next, statusOf } from "./harness.js";

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
