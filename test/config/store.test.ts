import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config/schema.js";
import { resolveSettings } from "../../src/config/settings.js";
import { readConfig, readInterview, writeConfig, writeInterview } from "../../src/config/store.js";
import { UserError } from "../../src/core/errors.js";
import { tempDir } from "../helpers.js";

const config: Config = {
  version: 1,
  mode: "brownfield",
  backend: "claude",
  targets: ["claude-code", "opencode"],
  lang: "es",
  digest: { maxChars: 50_000 },
  commands: { test: "npm test", lint: "npm run lint" },
  gates: { regression: "task" },
  verify: { allow: ["./scripts/check.sh"] },
  secrets: { allow: ["test/fixtures/**"] },
  agent: { timeoutMinutes: 30 },
};

async function writeRawConfig(cwd: string, text: string) {
  await mkdir(join(cwd, ".bae"), { recursive: true });
  await writeFile(join(cwd, ".bae", "config.json"), text);
}

describe("config store", () => {
  it("returns undefined when there is no config", async () => {
    expect(await readConfig(await tempDir())).toBeUndefined();
  });

  it("round-trips a config", async () => {
    const cwd = await tempDir();
    await writeConfig(cwd, config);
    expect(await readConfig(cwd)).toEqual(config);
  });

  it("fills the digest, commands and gates defaults", async () => {
    const cwd = await tempDir();
    const {
      digest: _,
      commands: __,
      gates: ___,
      agent: ____,
      verify: _____,
      secrets: ______,
      ...rest
    } = config;
    await writeRawConfig(cwd, JSON.stringify(rest));
    expect(await readConfig(cwd)).toMatchObject({
      digest: { maxChars: 100_000 },
      commands: {},
      gates: { regression: "full" },
      agent: { timeoutMinutes: 45 },
      verify: { allow: [] },
      secrets: { allow: [] },
    });
  });

  it("rejects an unknown regression mode", async () => {
    const cwd = await tempDir();
    await writeRawConfig(cwd, JSON.stringify({ ...config, gates: { regression: "sometimes" } }));
    await expect(readConfig(cwd)).rejects.toThrow(/gates/);
  });

  it("rejects malformed JSON with a user error", async () => {
    const cwd = await tempDir();
    await writeRawConfig(cwd, "{ nope");
    await expect(readConfig(cwd)).rejects.toThrow(UserError);
  });

  it("rejects values outside the schema and names the file", async () => {
    const cwd = await tempDir();
    await writeRawConfig(cwd, JSON.stringify({ ...config, backend: "gpt" }));
    await expect(readConfig(cwd)).rejects.toThrow(/config\.json[\s\S]*backend/);
  });

  it("stores the interview as markdown with a trailing newline", async () => {
    const cwd = await tempDir();
    expect(await readInterview(cwd)).toBeUndefined();
    await writeInterview(cwd, "# Interview");
    expect(await readInterview(cwd)).toBe("# Interview\n");
  });
});

describe("resolveSettings", () => {
  it("prefers flags over config", () => {
    expect(resolveSettings({ lang: "en", backend: "manual", yes: true }, config)).toEqual({
      lang: "en",
      backend: "manual",
      dryRun: false,
      yes: true,
    });
  });

  it("falls back to config, then defaults", () => {
    expect(resolveSettings({}, config)).toMatchObject({ lang: "es", backend: "claude" });
    expect(resolveSettings({}, undefined)).toEqual({
      lang: "en",
      backend: undefined,
      dryRun: false,
      yes: false,
    });
  });
});
