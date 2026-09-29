import { describe, expect, it } from "vitest";
import { agent, bypassRepo, next, PASS, REVIEW_PASS, statusOf } from "./harness.js";

const TYPECHECK = "npm run typecheck";
const scripts = (typecheck?: string) =>
  JSON.stringify({ name: "app", scripts: typecheck ? { typecheck } : {} });
const GREEN = 'node -e "process.exit(0)"';
const RED = "node -e \"console.error('error TS2322: bad'); process.exit(2)\"";

async function repo(command: string, typecheck?: string) {
  return bypassRepo({
    task: { command, scope: "- `src/feature.ts`\n- `package.json`" },
    files: { "package.json": scripts(typecheck) },
    config: { commands: { typecheck: TYPECHECK } },
  });
}

describe("bypass 41: a command that does not exist yet never lets a task pass (audit A1, A12)", () => {
  it("starts the task instead of stopping when the typecheck script is not written yet", async () => {
    const cwd = await repo(PASS);
    const run = await next(
      cwd,
      ["--headless", "--yes"],
      [agent(cwd, { "src/feature.ts": "x\n" }), REVIEW_PASS],
    );
    expect(run.log).toContain(`\`${TYPECHECK}\` does not exist yet`);
    expect(run.log).toContain(`\`${TYPECHECK}\` still does not exist`);
    expect(run.log).not.toContain("Regression:");
    expect(run.code).toBe(0);
  });

  it("fails a task whose Verification needs the command when the agent did not create it", async () => {
    const cwd = await repo(TYPECHECK);
    const run = await next(cwd, ["--yes"], [agent(cwd, { "src/feature.ts": "x\n" })]);
    expect(run.code).toBe(1);
    expect(await statusOf(cwd)).not.toBe("done");
  });

  it("passes that task once the agent creates the command and it is green", async () => {
    const cwd = await repo(TYPECHECK);
    const work = agent(cwd, { "src/feature.ts": "x\n", "package.json": scripts(GREEN) });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(await statusOf(cwd)).toBe("done");
  });

  it("blocks when the agent creates the command and it fails", async () => {
    const cwd = await repo(PASS);
    const work = agent(cwd, { "src/feature.ts": "x\n", "package.json": scripts(RED) });
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("Regression:");
    expect(await statusOf(cwd)).not.toBe("done");
  });

  it("blocks when the agent removes a command that existed before the task", async () => {
    const cwd = await repo(PASS, GREEN);
    const work = agent(cwd, { "src/feature.ts": "x\n", "package.json": scripts() });
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(await statusOf(cwd)).not.toBe("done");
  });

  it("blocks when the agent turns a failing command into a missing one", async () => {
    const cwd = await repo(PASS, RED);
    const work = agent(cwd, { "src/feature.ts": "x\n", "package.json": scripts() });
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(await statusOf(cwd)).not.toBe("done");
  });
});
