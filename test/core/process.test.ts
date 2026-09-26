import { describe, expect, it } from "vitest";
import { runCommand } from "../../src/core/process.js";

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

  it("flags a missing executable", async () => {
    const result = await runCommand("bae-definitely-missing-cli", [], { cwd: process.cwd() });
    expect(result.notFound).toBe(true);
    expect(result.exitCode).toBe(-1);
  });
});
