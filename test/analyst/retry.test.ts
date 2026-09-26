import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runWithFormatRetry } from "../../src/analyst/retry.js";
import { FormatError, UserError } from "../../src/core/errors.js";
import { fakeBackend } from "../fakes.js";
import { tempDir } from "../helpers.js";

const parse = (text: string) => {
  if (!text.startsWith("OK")) throw new FormatError("must start with OK");
  return text;
};

describe("runWithFormatRetry", () => {
  it("returns the first answer when it parses", async () => {
    const { backend, prompts } = fakeBackend(["OK first"]);
    const cwd = await tempDir();
    const result = await runWithFormatRetry({
      backend,
      prompt: "P",
      options: { cwd },
      parse,
      format: "OK ...",
    });
    expect(result).toBe("OK first");
    expect(prompts).toEqual(["P"]);
  });

  it("asks once to fix only the format, quoting the error and previous answer", async () => {
    const { backend, prompts } = fakeBackend(["bad answer", "OK fixed"]);
    const cwd = await tempDir();
    const retried: string[] = [];
    const result = await runWithFormatRetry({
      backend,
      prompt: "P",
      options: { cwd },
      parse,
      format: "OK followed by text",
      onRetry: (error) => retried.push(error.message),
    });
    expect(result).toBe("OK fixed");
    expect(retried).toEqual(["must start with OK"]);
    expect(prompts[1]).toContain("Problem: must start with OK");
    expect(prompts[1]).toContain("OK followed by text");
    expect(prompts[1]).toContain("<previous_response>\nbad answer\n</previous_response>");
  });

  it("gives up after one retry and keeps the raw answer", async () => {
    const { backend } = fakeBackend(["bad", "still bad"]);
    const cwd = await tempDir();
    await expect(
      runWithFormatRetry({ backend, prompt: "P", options: { cwd }, parse, format: "OK" }),
    ).rejects.toThrow(UserError);
    expect(await readFile(join(cwd, ".bae", "tmp", "last-response.md"), "utf8")).toBe("still bad");
  });
});
