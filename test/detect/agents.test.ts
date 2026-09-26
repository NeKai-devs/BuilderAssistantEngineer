import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectInstalledAgents, findExecutable, suggestBackend } from "../../src/detect/agents.js";
import { tempDir, writeFiles } from "../helpers.js";

describe("agent detection", () => {
  it("finds executables on PATH in preference order", async () => {
    const bin = await tempDir();
    await writeFiles(bin, { gemini: "", opencode: "" });
    const env = { PATH: bin };
    expect(await findExecutable("gemini", env, "linux")).toBe(join(bin, "gemini"));
    expect(await detectInstalledAgents(env, "linux")).toEqual(["opencode", "gemini"]);
    expect(await suggestBackend(env, "linux")).toBe("opencode");
  });

  it("uses PATHEXT on Windows", async () => {
    const bin = await tempDir();
    await writeFiles(bin, { "claude.CMD": "" });
    const env = { Path: bin, PATHEXT: ".EXE;.CMD" };
    expect(await detectInstalledAgents(env, "win32")).toEqual(["claude"]);
  });

  it("falls back to api with credentials, else manual", async () => {
    const empty = { PATH: await tempDir() };
    expect(await suggestBackend({ ...empty, ANTHROPIC_API_KEY: "k" }, "linux")).toBe("api");
    expect(await suggestBackend(empty, "linux")).toBe("manual");
  });
});
