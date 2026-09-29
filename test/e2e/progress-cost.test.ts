import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { writeConfig, writeInterview } from "../../src/config/store.js";
import { fakePrompter, type Step, scriptedBackend } from "../fakes.js";
import { tempDir } from "../helpers.js";
import { planOutput } from "../plan-sample.js";
import { agent, attempts, bypassRepo, next } from "./bypass/harness.js";

async function planRepo(): Promise<string> {
  const cwd = await tempDir();
  await writeConfig(cwd, {
    version: 1,
    mode: "greenfield",
    backend: "claude",
    targets: ["claude-code"],
    lang: "en",
  });
  await writeInterview(cwd, "# Interview\n\nA tool.\n");
  return cwd;
}

async function plan(cwd: string, steps: Step[]) {
  const ui = fakePrompter([]);
  const ai = scriptedBackend(steps);
  const printed: string[] = [];
  const code = await main(["node", "bae", "plan", "--yes"], cwd, {
    prompter: ui.prompter,
    createBackend: () => ai.backend,
    env: {},
    print: (text) => printed.push(text),
  });
  return { code, log: ui.log, printed: printed.join("") };
}

const streamed =
  (cost: number | undefined, text = planOutput()): Step =>
  (_prompt, options) => {
    options.onProgress?.({ type: "tool", tool: "Read", detail: "README.md" });
    for (let index = 0; index < text.length; index += 50) {
      options.onProgress?.({ type: "text", text: text.slice(index, index + 50) });
    }
    if (cost !== undefined) options.onInfo?.({ costUsd: cost });
    return text;
  };

describe("progress and cost on screen (audit A4)", () => {
  it("names each plan file while the answer arrives and ends with time and cost", async () => {
    const cwd = await planRepo();
    const run = await plan(cwd, [streamed(2.3)]);
    expect(run.code).toBe(0);
    const spins = run.log.filter((line) => line.startsWith("spin: "));
    expect(spins[0]).toBe("spin: claude is writing the plan (10–40 min) · reading README.md");
    expect(spins).toContain("spin: claude is writing the plan (10–40 min) · 1 file(s) · AGENTS.md");
    expect(spins.at(-1)).toMatch(/· \d+ file\(s\) · \.claude\/commands\/next\.md$/);
    expect(run.printed).toMatch(/Took \d+s · AI cost \$2\.30\n$/);
  });

  it("still shows what a failed command cost", async () => {
    const cwd = await planRepo();
    const run = await plan(cwd, [streamed(0.3, "not a plan"), streamed(0.3, "still not")]);
    expect(run.code).toBe(1);
    expect(run.printed).toContain("AI cost $0.60");
  });

  it("says when the backend does not report its cost", async () => {
    const cwd = await planRepo();
    const run = await plan(cwd, [streamed(undefined)]);
    expect(run.printed).toContain("AI cost not reported by claude");
  });

  it("shows the headless agent's steps and records each attempt's cost for status", async () => {
    const cwd = await bypassRepo();
    const work = agent(cwd, { "src/feature.ts": "x\n" });
    const priced: Step = async (prompt, options) => {
      options.onProgress?.({ type: "tool", tool: "Read", detail: "src/feature.ts" });
      options.onProgress?.({ type: "tool", tool: "Bash", detail: "npm test" });
      options.onInfo?.({ costUsd: 1 });
      return work(prompt, options);
    };
    const review: Step = (_prompt, options) => {
      options.onInfo?.({ costUsd: 0.25 });
      return '{"verdict": "pass", "findings": []}';
    };
    const run = await next(cwd, ["--headless", "--yes"], [priced, review]);
    expect(run.code).toBe(0);
    expect(run.printed).toContain("· reading src/feature.ts");
    expect(run.printed).toContain("· running npm test");
    expect(run.log).toMatch(/This attempt took \d+s · AI cost \$1\.25/);
    expect((await attempts(cwd))[0].costUsd).toBe(1.25);
    const printed: string[] = [];
    await main(["node", "bae", "status"], cwd, { print: (text) => printed.push(text) });
    expect(printed.join("")).toContain(
      "AI cost: $1.25 over the 1 of 1 attempt(s) that reported it",
    );
  });
});
