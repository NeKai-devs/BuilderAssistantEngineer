import { describe, expect, it } from "vitest";
import { writeFiles } from "../../helpers.js";
import { agent, bypassRepo, COUNTED, next, REVIEW_PASS, read } from "./harness.js";

describe("bypass 17: each suite command is compared only with its own baseline", () => {
  it("does not treat a new red command as preexisting because another red command had the same key", async () => {
    const before = COUNTED("never.txt");
    const cwd = await bypassRepo({ config: { commands: { test: before } } });
    const failing = agent(cwd, { "src/feature.ts": "x\n" });
    const first = await next(
      cwd,
      ["--yes"],
      [failing, () => '{"verdict": "fail", "findings": []}'],
    );
    expect(first.code).toBe(1);
    const after = COUNTED("never.txt", 12);
    const config = await read(cwd, ".bae/config.json");
    await writeFiles(cwd, {
      ".bae/config.json": config.replace(
        JSON.stringify(before).slice(1, -1),
        JSON.stringify(after).slice(1, -1),
      ),
    });
    const second = await next(cwd, ["--yes"], [failing, REVIEW_PASS]);
    expect(second.code).toBe(1);
    expect(second.log).toContain(`Regression: \`${after}\` exits with 1 after the task.`);
  });
});
