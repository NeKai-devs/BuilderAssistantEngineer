import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createManualBackend } from "../../src/backends/manual.js";
import { tempDir, writeFiles } from "../helpers.js";

function io(lines: string[], copy = async (_: string) => {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const written: string[] = [];
  output.on("data", (chunk) => written.push(String(chunk)));
  input.end(lines.join("\n"));
  return { io: { input, output, copy }, written: () => written.join("") };
}

describe("manual backend", () => {
  it("prints and copies the prompt, then reads a pasted answer until EOF", async () => {
    const cwd = await tempDir();
    const copied: string[] = [];
    const setup = io(["line one", "", "line three"], async (text) => {
      copied.push(text);
    });
    const answer = await createManualBackend(setup.io).run("THE PROMPT", { cwd });
    expect(answer).toBe("line one\n\nline three");
    expect(copied).toEqual(["THE PROMPT"]);
    expect(setup.written()).toContain("THE PROMPT");
    expect(setup.written()).toContain(".bae/tmp/prompt.md");
    expect(await readFile(join(cwd, ".bae", "tmp", "prompt.md"), "utf8")).toBe("THE PROMPT");
  });

  it("reads the answer file when the user just presses Enter", async () => {
    const cwd = await tempDir();
    const input = new PassThrough();
    const output = new PassThrough();
    const waiting = new Promise<void>((resolve) =>
      output.on("data", (chunk) => String(chunk).includes("press Enter") && resolve()),
    );
    const pending = createManualBackend({ input, output, copy: async () => {} }).run("P", { cwd });
    await waiting;
    await writeFiles(cwd, { ".bae/tmp/response.md": "FROM FILE" });
    input.end("\n");
    expect(await pending).toBe("FROM FILE");
  });

  it("keeps going without a clipboard and rejects an empty answer", async () => {
    const cwd = await tempDir();
    const setup = io([""], async () => {
      throw new Error("no clipboard");
    });
    await expect(createManualBackend(setup.io).run("P", { cwd })).rejects.toThrow("No answer");
    expect(setup.written()).toContain("Could not use the clipboard");
  });

  it("waits for Enter in interactive mode and returns nothing", async () => {
    const setup = io([""]);
    expect(
      await createManualBackend(setup.io).run("P", { cwd: await tempDir(), interactive: true }),
    ).toBe("");
    expect(setup.written()).toContain("press Enter when the task is finished");
  });
});
