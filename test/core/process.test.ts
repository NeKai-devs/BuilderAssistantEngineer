import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../../src/core/process.js";
import { dropAllScratch, scratchDir } from "../../src/core/scratch.js";
import { tempDir } from "../helpers.js";

describe("runCommand", () => {
  it("pipes stdin, streams stdout and reports the exit code", async () => {
    const chunks: string[] = [];
    const script =
      "process.stdin.pipe(process.stdout); process.stdin.on('end', () => process.exit(3));";
    const result = await runCommand(process.execPath, ["-e", script], {
      cwd: process.cwd(),
      input: "hello",
      onStdout: (chunk) => chunks.push(chunk),
    });
    expect(result).toMatchObject({ exitCode: 3, stdout: "hello", notFound: false });
    expect(chunks.join("")).toBe("hello");
  });

  it("sets PWD to the working directory of the child", async () => {
    const cwd = await tempDir();
    const result = await runCommand(
      process.execPath,
      ["-e", "process.stdout.write(process.env.PWD ?? '')"],
      {
        cwd,
      },
    );
    expect(result.stdout).toBe(cwd);
  });

  it("flags a missing executable", async () => {
    const result = await runCommand("bae-definitely-missing-cli", [], { cwd: process.cwd() });
    expect(result.notFound).toBe(true);
    expect(result.exitCode).toBe(-1);
  });
});

describe("process groups and scratch files (audit A11)", () => {
  it.skipIf(process.platform === "win32")(
    "stops an agent and the processes it started when its time is up",
    async () => {
      const cwd = await tempDir();
      const started = Date.now();
      const result = await runCommand(
        "sh",
        ["-c", "sleep 30 & echo $! > grandchild.pid; sleep 30"],
        { cwd, timeoutMs: 500 },
      );
      expect(result.timedOut).toBe(true);
      expect(Date.now() - started).toBeLessThan(10_000);
      const pid = Number(await readFile(join(cwd, "grandchild.pid"), "utf8"));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(() => process.kill(pid, 0)).toThrow();
    },
  );

  it("removes every scratch directory still in use when bae is interrupted", async () => {
    const dir = await scratchDir("bae-test-scratch-");
    dropAllScratch();
    await expect(stat(dir)).rejects.toThrow();
  });
});
