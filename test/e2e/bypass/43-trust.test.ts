import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli.js";
import { fakePrompter } from "../../fakes.js";
import { taskFile } from "../../plan-sample.js";
import { agent, bypassRepo, next, PASS, REVIEW_PASS, read } from "./harness.js";

const marks = (file: string) => `node -e "require('fs').writeFileSync('${file}', '')"`;
const TRUST = "Do you trust them?";

async function cloned(): Promise<string> {
  return bypassRepo({
    task: { command: marks("verification-ran.txt") },
    files: {
      "docs/plan/tasks/T-002-second.md": taskFile("T-002", { dependsOn: ["T-001"], command: PASS }),
    },
    config: { commands: { lint: marks("lint-ran.txt") }, verify: { allow: ["make deploy"] } },
  });
}

async function ran(cwd: string, file: string): Promise<boolean> {
  return read(cwd, file).then(
    () => true,
    () => false,
  );
}

describe("bypass 43: a repository's own commands never run before a person trusts them (audit A7)", () => {
  it("asks once before the first run, even with --headless --yes, and runs nothing on no", async () => {
    const cwd = await cloned();
    const run = await next(cwd, ["--headless", "--yes"], [], [false], false);
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(0);
    expect(run.ui.asked.some((question) => question.includes(TRUST))).toBe(true);
    expect(await ran(cwd, "lint-ran.txt")).toBe(false);
    expect(await ran(cwd, "verification-ran.txt")).toBe(false);
    expect(run.log).toContain("Nothing was run.");
  });

  it("shows the project commands, every open task's checks and verify.allow before asking", async () => {
    const cwd = await cloned();
    const run = await next(cwd, ["--yes"], [], [false], false);
    expect(run.log).toContain("Commands this repository makes bae run");
    expect(run.log).toContain(`$ ${marks("lint-ran.txt")}`);
    expect(run.log).toContain("T-001 · Do T-001");
    expect(run.log).toContain(`$ ${marks("verification-ran.txt")}`);
    expect(run.log).toContain("T-002 · Do T-002");
    expect(run.log).toContain("make deploy");
  });

  it("runs after a yes and does not ask again in that repository", async () => {
    const cwd = await cloned();
    const work = agent(cwd, { "src/feature.ts": "x\n" });
    const first = await next(cwd, ["--headless", "--yes"], [work, REVIEW_PASS], [true], false);
    expect(first.code).toBe(0);
    expect(await ran(cwd, "lint-ran.txt")).toBe(true);
    const more = agent(cwd, { "src/other.ts": "y\n" });
    const second = await next(cwd, ["--headless", "--yes"], [more, REVIEW_PASS], [], false);
    expect(second.code).toBe(0);
    expect(second.ui.asked.some((question) => question.includes(TRUST))).toBe(false);
  });

  it("stops with a clear message when there is no terminal to ask in", async () => {
    const cwd = await cloned();
    const ui = fakePrompter([]);
    const code = await main(["node", "bae", "next", "--headless", "--yes"], cwd, {
      prompter: { ...ui.prompter, canAsk: () => false },
      createBackend: () => ({
        name: "claude",
        run: async () => {
          throw new Error("no agent expected");
        },
      }),
      env: {},
      print: () => {},
    });
    expect(code).toBe(1);
    expect(ui.log.join("\n")).toContain(
      "Run npx builder-assistant-engineer next once in a terminal",
    );
    expect(await ran(cwd, "lint-ran.txt")).toBe(false);
  });

  it("asks nothing on a dry run, which runs nothing", async () => {
    const cwd = await cloned();
    const run = await next(cwd, ["--yes", "--dry-run"], [], [], false);
    expect(run.code).toBe(0);
    expect(run.ui.asked).toEqual([]);
  });
});
