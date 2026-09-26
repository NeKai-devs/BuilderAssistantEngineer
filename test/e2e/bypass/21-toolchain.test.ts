import { describe, expect, it } from "vitest";
import { agent, bypassRepo, next, REVIEW_PASS, read } from "./harness.js";

describe("bypass 21: tool settings that decide how the checks run are protected", () => {
  it("removes a new .npmrc that turns every npm script into a no-op", async () => {
    const cwd = await bypassRepo({
      files: {
        "package.json": JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }, null, 2),
      },
      config: { commands: { test: "npm test" } },
      task: { command: "npm test" },
    });
    const cheat = agent(cwd, { "src/feature.ts": "x\n", ".npmrc": "script-shell=/bin/true\n" });
    const run = await next(cwd, ["--yes", "--allow-skip"], [cheat, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      ".npmrc: Changed a package manager or tool setting that decides how the checks run. Removed.",
    );
    await expect(read(cwd, ".npmrc")).rejects.toThrow();
  });
});
