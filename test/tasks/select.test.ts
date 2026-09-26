import { describe, expect, it } from "vitest";
import { parseTask } from "../../src/tasks/schema.js";
import { pickNext, waitingOn } from "../../src/tasks/select.js";
import { taskFile } from "../plan-sample.js";

const task = (id: string, status: string, dependsOn: string[] = [], phase = 1) =>
  parseTask(
    `docs/plan/tasks/${id}-x.md`,
    taskFile(id, { status, dependsOn }).replace("phase: 1", `phase: ${phase}`),
  );

describe("pickNext", () => {
  it("resumes a task in progress first", () => {
    const tasks = [task("T-001", "pending"), task("T-002", "in_progress")];
    expect(pickNext(tasks)?.meta.id).toBe("T-002");
  });

  it("takes the first pending task whose dependencies are done, by phase then id", () => {
    const tasks = [
      task("T-001", "done"),
      task("T-003", "pending", ["T-002"]),
      task("T-002", "blocked"),
      task("T-010", "pending", [], 2),
      task("T-004", "pending", ["T-001"], 2),
      task("T-005", "pending", [], 1),
    ];
    expect(pickNext(tasks)?.meta.id).toBe("T-005");
    expect(waitingOn(tasks[1] as never, tasks)).toEqual(["T-002"]);
  });

  it("returns nothing when every remaining task is blocked or waiting", () => {
    expect(
      pickNext([task("T-001", "blocked"), task("T-002", "pending", ["T-001"])]),
    ).toBeUndefined();
  });
});
