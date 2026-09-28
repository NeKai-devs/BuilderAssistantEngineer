import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli.js";
import { writeConfig, writeInterview } from "../../../src/config/store.js";
import { fakeBackend, fakePrompter } from "../../fakes.js";
import { captureOutput, copyFixture } from "../../helpers.js";
import { defaultFiles, planOutput } from "../../plan-sample.js";

async function brownfield(mode: "brownfield" | "greenfield" = "brownfield") {
  const cwd = await copyFixture("node-app");
  await writeConfig(cwd, {
    version: 1,
    mode,
    backend: "claude",
    targets: ["claude-code"],
    lang: "en",
    digest: { maxChars: 20_000 },
  });
  await writeInterview(cwd, "# Interview\n\nAdd team accounts.\n");
  return cwd;
}

async function plan(cwd: string, replies: string[]) {
  const ui = fakePrompter([]);
  const ai = fakeBackend(replies);
  const code = await main(["node", "bae", "plan", "--yes"], cwd, {
    prompter: ui.prompter,
    createBackend: () => ai.backend,
    env: {},
    print: () => {},
  });
  return { code, log: ui.log.join("\n"), prompts: ai.prompts };
}

const exists = (cwd: string, path: string) =>
  readFile(join(cwd, path), "utf8").then(
    () => true,
    () => false,
  );

describe("bypass 09: cited lines are checked, and a wrong one stops the plan", () => {
  it("does not write a brownfield plan whose line citations stay wrong after the fix request", async () => {
    const cwd = await brownfield();
    const output = captureOutput();
    const architecture =
      "Users are mounted in `src/index.ts:40-90` and tested in `users.test.ts:999`.";
    const files = { ...defaultFiles(), "docs/plan/02-architecture.md": architecture };
    const same = `<<<FILE: docs/plan/02-architecture.md>>>\n${architecture}\n<<<END FILE>>>`;
    const run = await plan(cwd, [planOutput({ files }), same]);
    expect(run.code).toBe(1);
    expect(run.prompts).toHaveLength(2);
    expect(output.err()).toContain(
      "`src/index.ts:40-90` in docs/plan/02-architecture.md (the file has 7 lines)",
    );
    expect(output.err()).toContain(
      "`users.test.ts:999` in docs/plan/02-architecture.md (the file has 3 lines)",
    );
    expect(await exists(cwd, "docs/plan/02-architecture.md")).toBe(false);
    expect(await exists(cwd, ".bae/tmp/rejected-plan.md")).toBe(true);
  });

  it("writes the plan once the analyst fixes the cited lines", async () => {
    const cwd = await brownfield();
    const files = {
      ...defaultFiles(),
      "docs/plan/02-architecture.md": "Mounted in `src/index.ts:40`.",
    };
    const fixed =
      "<<<FILE: docs/plan/02-architecture.md>>>\nMounted in `src/index.ts:1-7`.\n<<<END FILE>>>";
    const run = await plan(cwd, [planOutput({ files }), fixed]);
    expect(run.code).toBe(0);
    expect(await exists(cwd, "docs/plan/02-architecture.md")).toBe(true);
  });

  it("keeps paths without a line as a warning", async () => {
    const cwd = await brownfield();
    const architecture = "Auth will live next to `src/services/auth.ts`.";
    const files = { ...defaultFiles(), "docs/plan/02-architecture.md": architecture };
    const same = `<<<FILE: docs/plan/02-architecture.md>>>\n${architecture}\n<<<END FILE>>>`;
    const run = await plan(cwd, [planOutput({ files }), same]);
    expect(run.code).toBe(0);
    expect(run.log).toContain("Unverified paths (not in the repository and not marked new):");
  });
});
