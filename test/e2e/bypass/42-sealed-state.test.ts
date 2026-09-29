import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { git } from "../../../src/core/git.js";
import { repoState } from "../../../src/core/state.js";
import { markActive, prepareCapture, saveCapture } from "../../../src/gates/capture.js";
import { parseTask } from "../../../src/tasks/schema.js";
import { runFile, testConfig, writeFiles } from "../../helpers.js";
import { agent, bypassRepo, fake, next, REVIEW_PASS, read, TASK } from "./harness.js";

const NPM_TOKEN = fake("npm", "_SEALEDaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const REMOTE = `https://x-access-token:${fake("ghp", "_SEALEDbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")}@github.com/o/r.git`;
const ENVRC = "export AWS_SECRET_ACCESS_KEY=SEALEDccccccccccccccccccccccccccccccc\n";
const NPMRC = `//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n`;

async function repo(): Promise<string> {
  const cwd = await bypassRepo({ files: { ".npmrc": NPMRC, ".envrc": ENVRC } });
  await git(cwd, ["remote", "add", "origin", REMOTE]);
  return cwd;
}

describe("bypass 42: the state directory keeps no credentials in clear (audit A9)", () => {
  it("stores only fingerprints of .git/config, .npmrc and .envrc in capture.json", async () => {
    const cwd = await repo();
    const run = await next(
      cwd,
      ["--headless", "--yes"],
      [agent(cwd, { "src/feature.ts": "x\n" }), REVIEW_PASS],
    );
    expect(run.code).toBe(0);
    const text = await readFile(runFile(cwd, "T-001", "capture.json"), "utf8");
    for (const secret of [NPM_TOKEN, "ghp_SEALED", "SEALEDccc"]) expect(text).not.toContain(secret);
    const capture = JSON.parse(text);
    expect(Object.keys(capture.sealed).sort()).toEqual([".envrc", ".git/config", ".npmrc"]);
    expect(Object.keys(capture.protected)).not.toContain(".npmrc");
  });

  it.skipIf(process.platform === "win32")(
    "writes the state directory for the user alone",
    async () => {
      const cwd = await repo();
      await next(
        cwd,
        ["--headless", "--yes"],
        [agent(cwd, { "src/feature.ts": "x\n" }), REVIEW_PASS],
      );
      const mode = async (path: string) => (await stat(path)).mode & 0o777;
      expect(await mode(repoState(cwd))).toBe(0o700);
      expect(await mode(runFile(cwd, "T-001", "capture.json"))).toBe(0o600);
      expect(await mode(runFile(cwd, "T-001", "attempts.jsonl"))).toBe(0o600);
    },
  );

  it("still restores a credentials file the agent changed during the run", async () => {
    const cwd = await repo();
    const cheat = agent(cwd, {
      "src/feature.ts": "x\n",
      ".npmrc": `${NPMRC}script-shell=/bin/true\n`,
    });
    const run = await next(cwd, ["--yes"], [cheat]);
    expect(run.code).toBe(1);
    expect(await read(cwd, ".npmrc")).toBe(NPMRC);
  });

  it("blocks, without deleting it, a credentials file changed while a run was interrupted", async () => {
    const cwd = await repo();
    const task = parseTask(TASK, await read(cwd, TASK));
    await saveCapture(cwd, await prepareCapture(cwd, testConfig(), task));
    await markActive(cwd, "T-001");
    await writeFiles(cwd, { ".npmrc": `${NPMRC}script-shell=/bin/true\n` });
    const run = await next(cwd, ["--yes", "--dry-run"], []);
    expect(run.log).toContain("An earlier run of T-001 ended before its checks");
    expect(run.log).toContain("bae keeps only a fingerprint of this file");
    expect(await read(cwd, ".npmrc")).toContain("script-shell=/bin/true");
  });
});
