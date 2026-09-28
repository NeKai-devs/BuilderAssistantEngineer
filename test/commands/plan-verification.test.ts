import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { writeConfig, writeInterview } from "../../src/config/store.js";
import { splitFrontmatter } from "../../src/tasks/frontmatter.js";
import { fakeBackend, fakePrompter, scriptedBackend } from "../fakes.js";
import { tempDir } from "../helpers.js";
import { defaultFiles, planOutput, taskFile } from "../plan-sample.js";

const T1 = "docs/plan/tasks/T-001-setup-baseline.md";
const T2 = "docs/plan/tasks/T-002-add-feature.md";
const read = (cwd: string, path: string) => readFile(join(cwd, path), "utf8");
const meta = async (cwd: string, path: string) => splitFrontmatter(await read(cwd, path))?.data;
const masked = taskFile("T-002", { dependsOn: ["T-001"], command: "npm test || true" });
const fixed = taskFile("T-002", { dependsOn: ["T-001"], command: "npm test" });
const withTask = (content: string) => planOutput({ files: { ...defaultFiles(), [T2]: content } });
const fileBlock = (path: string, content: string) =>
  `<<<FILE: ${path}>>>\n${content.trimEnd()}\n<<<END FILE>>>`;

async function setup(): Promise<string> {
  const cwd = await tempDir();
  await writeConfig(cwd, {
    version: 1,
    mode: "greenfield",
    backend: "claude",
    targets: ["claude-code"],
    lang: "en",
    digest: { maxChars: 20_000 },
  });
  await writeInterview(cwd, "# Interview\n\nA local web app.\n");
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
  return { code, ai, log: ui.log.join("\n") };
}

describe("plan and a Verification the CLI cannot accept", () => {
  it("asks for a fix of only those files and merges only them", async () => {
    const cwd = await setup();
    const reply = [fileBlock(T2, fixed), fileBlock(T1, "tampered")].join("\n");
    const run = await plan(cwd, [withTask(masked), reply]);
    expect(run.code).toBe(0);
    expect(run.ai.prompts).toHaveLength(2);
    expect(run.ai.prompts[1]).toContain("The CLI cannot accept the Verification block");
    expect(run.ai.prompts[1]).toContain(`- ${T2}: Verification hides failures`);
    expect(run.ai.prompts[1]).not.toContain("did not follow the required output format");
    expect(await read(cwd, T2)).not.toContain("|| true");
    expect(await read(cwd, T1)).toContain("id: T-001");
    expect(run.log).toContain("Every Verification is fixed.");
    expect(JSON.parse(await read(cwd, ".bae/tmp/plan-report.json"))).toMatchObject({
      verificationRetries: 1,
      formatRetries: 0,
      needsReview: [],
    });
  });

  it("writes the whole plan and marks the task needs_review when the fix fails", async () => {
    const cwd = await setup();
    const run = await plan(cwd, [withTask(masked), "I cannot change that."]);
    expect(run.code).toBe(0);
    expect(await read(cwd, "docs/plan/00-overview.md")).toBe("# Overview\n");
    expect(await meta(cwd, T1)).toMatchObject({ status: "pending" });
    const reviewed = await meta(cwd, T2);
    expect(reviewed).toMatchObject({ status: "needs_review" });
    expect(String(reviewed?.review_note)).toContain("Verification hides failures");
    expect(String(reviewed?.review_note)).toContain("npm test || true");
    expect(run.log).toContain(
      "1 task(s) need review before next can run them: T-002. Each file's review_note says what to fix",
    );
    expect(JSON.parse(await read(cwd, ".bae/tmp/plan-report.json"))).toMatchObject({
      ok: true,
      needsReview: ["T-002"],
    });
  });

  it("lists many tasks with the same problem on one line", async () => {
    const cwd = await setup();
    const files: Record<string, string> = { ...defaultFiles() };
    for (const n of [1, 2, 3, 4, 5, 6]) {
      delete files[n === 1 ? T1 : T2];
      files[`docs/plan/tasks/T-00${n}-step.md`] = taskFile(`T-00${n}`, {
        command: "python3 app.py & sleep 1; npm test || true",
      });
    }
    const run = await plan(cwd, [planOutput({ files }), "no"]);
    expect(run.code).toBe(0);
    const warnings = run.log.split("\n").filter((line) => line.includes("hides failures"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("(T-001, T-002, T-003, T-004, T-005, T-006)");
  });

  it("does not run a task that needs review, and says why", async () => {
    const cwd = await setup();
    await plan(cwd, [withTask(masked), "no"]);
    await writeFile(
      join(cwd, T1),
      (await read(cwd, T1)).replace("status: pending", "status: done"),
    );
    const ui = fakePrompter([]);
    const ai = scriptedBackend([]);
    const code = await main(["node", "bae", "next", "--yes"], cwd, {
      prompter: ui.prompter,
      createBackend: () => ai.backend,
      env: {},
      print: () => {},
    });
    expect(code).toBe(0);
    expect(ai.calls).toHaveLength(0);
    const log = ui.log.join("\n");
    expect(log).toContain("T-002 Do T-002 (needs review: Verification hides failures");
    expect(log).toContain("Fix what a task that needs review says in its file");
  });

  it("accepts a server started in the background and checked with curl -sf", async () => {
    const cwd = await setup();
    const server = taskFile("T-002", {
      dependsOn: ["T-001"],
      command: "python3 app.py &\ntrap 'kill $!' EXIT\nsleep 1\ncurl -sf http://127.0.0.1:8000/",
    });
    const run = await plan(cwd, [withTask(server)]);
    expect(run.code).toBe(0);
    expect(run.ai.prompts).toHaveLength(1);
    expect(await meta(cwd, T2)).toMatchObject({ status: "pending" });
  });
});
