import { describe, expect, it } from "vitest";
import { bashPath, runScript } from "../../src/core/bash.js";
import { tempDir } from "../helpers.js";

describe("runScript", () => {
  it.skipIf(process.platform === "win32")(
    "stops a process the script leaves running when the time is up",
    async () => {
      const bash = (await bashPath()) ?? "bash";
      const started = Date.now();
      const result = await runScript(bash, 'node -e "setInterval(() => {}, 1000)"\n', {
        cwd: await tempDir(),
        timeoutMs: 1_000,
      });
      expect(result.exitCode).toBe(-1);
      expect(Date.now() - started).toBeLessThan(10_000);
    },
    20_000,
  );
});
