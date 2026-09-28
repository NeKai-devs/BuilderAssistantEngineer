import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isWeakModel,
  noteOpencodeModel,
  opencodeModel,
} from "../../src/backends/opencode-model.js";
import type { CommandContext } from "../../src/commands/context.js";
import { fakeBackend, fakePrompter } from "../fakes.js";
import { tempDir, writeFiles } from "../helpers.js";

describe("opencodeModel", () => {
  it("prefers the project's config, then OPENCODE_CONFIG, then the global one", async () => {
    const project = await tempDir();
    const config = await tempDir();
    await writeFiles(config, { "opencode/opencode.json": '{ "model": "opencode/big-pickle" }' });
    const env = { XDG_CONFIG_HOME: config };
    expect(await opencodeModel(project, env)).toEqual({
      model: "opencode/big-pickle",
      source: join(config, "opencode", "opencode.json"),
    });
    await writeFiles(project, {
      "opencode.jsonc":
        '{\n  // strong model for plans\n  "model": "anthropic/claude-opus-5-5",\n}\n',
    });
    expect(await opencodeModel(project, env)).toEqual({
      model: "anthropic/claude-opus-5-5",
      source: "opencode.jsonc",
    });
    const inline = { ...env, OPENCODE_CONFIG_CONTENT: '{"model":"openai/gpt-5-mini"}' };
    expect((await opencodeModel(project, inline)).model).toBe("openai/gpt-5-mini");
  });

  it("reports no model when none is configured", async () => {
    const env = { XDG_CONFIG_HOME: await tempDir() };
    expect(await opencodeModel(await tempDir(), env)).toEqual({});
  });

  it("flags free and small models", () => {
    for (const model of [
      "opencode/nemotron-3.5-lightning-free",
      "opencode/big-pickle",
      "openai/gpt-5-mini",
      "google/gemini-2.5-flash",
      "ollama/qwen3-8b",
    ]) {
      expect(isWeakModel(model)).toBe(true);
    }
    for (const model of ["anthropic/claude-opus-5-5", "openai/gpt-5", "ollama/qwen3-235b"]) {
      expect(isWeakModel(model)).toBe(false);
    }
  });

  it("warns before a plan when opencode would use a free model or none", async () => {
    const config = await tempDir();
    const note = async (cwd: string) => {
      const ui = fakePrompter([]);
      const ctx: CommandContext = {
        cwd,
        flags: {},
        prompter: ui.prompter,
        createBackend: () => fakeBackend([]).backend,
        env: { XDG_CONFIG_HOME: config },
        print: () => {},
      };
      await noteOpencodeModel(ctx);
      return ui.log.join("\n");
    };
    expect(await note(await tempDir())).toContain('warn: opencode has no "model" in opencode.json');
    const free = await tempDir();
    await writeFiles(free, { "opencode.json": '{"model":"opencode/space-bunny-free"}' });
    expect(await note(free)).toContain(
      "warn: opencode will use opencode/space-bunny-free (from opencode.json), which looks like a free or small model",
    );
    const strong = await tempDir();
    await writeFiles(strong, { "opencode.json": '{"model":"anthropic/claude-opus-5-5"}' });
    expect(await note(strong)).toBe(
      "info: opencode will use anthropic/claude-opus-5-5 (from opencode.json).",
    );
  });
});
