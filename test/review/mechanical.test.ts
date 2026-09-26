import { describe, expect, it } from "vitest";
import { taskChanges } from "../../src/review/changes.js";
import { mechanicalReview } from "../../src/review/mechanical.js";
import { inScope, scopePaths } from "../../src/review/scope.js";
import { parseTask } from "../../src/tasks/schema.js";
import { captureFor, copyFixture, gitCommitAll, writeFiles } from "../helpers.js";
import { type TaskOptions, taskFile } from "../plan-sample.js";

const fake = (...parts: string[]) => parts.join("");
const TASK = "docs/plan/tasks/T-001-config.md";
const SCOPE = "In:\n- `src/config.js`\n- `src/keys.js` (new)\nOut: `README.md`, billing.";

function task(options: TaskOptions = {}) {
  return parseTask(TASK, taskFile("T-001", { scope: SCOPE, ...options }));
}

async function changedRepo(files: Record<string, string>) {
  const cwd = await copyFixture("with-secrets");
  await gitCommitAll(cwd, "base");
  const capture = await captureFor(cwd, task());
  await writeFiles(cwd, files);
  const view = await taskChanges(cwd, capture);
  if (!view.ok) throw new Error("expected a git repository");
  return view.changes;
}

describe("scopePaths", () => {
  it("reads in-scope paths up to the Out line and drops the (new) marker", () => {
    expect(scopePaths(task())).toEqual(["src/config.js", "src/keys.js"]);
    const listed = task({ scope: "- src/routes/\n- lib/**/*.ts\n- run the tests" });
    expect(scopePaths(listed)).toEqual(["src/routes/", "lib/**/*.ts"]);
  });

  it("matches files, directories and globs", () => {
    const patterns = ["src/config.js", "src/routes/", "lib/**/*.ts"];
    expect(inScope("src/config.js", patterns)).toBe(true);
    expect(inScope("src/routes/users.js", patterns)).toBe(true);
    expect(inScope("lib/a/b/c.ts", patterns)).toBe(true);
    expect(inScope("lib/c.ts", patterns)).toBe(true);
    expect(inScope("lib/c.js", patterns)).toBe(false);
    expect(inScope("src/other.js", patterns)).toBe(false);
  });
});

describe("mechanicalReview on the with-secrets fixture", () => {
  it("passes a change inside the Scope and ignores the .env file already tracked", async () => {
    const changes = await changedRepo({ "src/config.js": "export const a = 1;\n" });
    expect(mechanicalReview(task(), changes)).toEqual({ passed: true, findings: [] });
  });

  it("fails when the change touches the .env file", async () => {
    const changes = await changedRepo({ ".env": "API_TOKEN=another-value\n" });
    const result = mechanicalReview(task(), changes);
    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual({
      severity: "blocker",
      id: expect.stringMatching(/^secret-[0-9a-f]{8}$/),
      file: ".env",
      message:
        "Looks like a secrets file (.env, private key or credentials); keep it out of the change.",
    });
  });

  it("fails when added lines contain a credential, in tracked or new files", async () => {
    const key = fake("AKIA", "ABCDEFGHIJKLMNOP");
    const changes = await changedRepo({
      "src/config.js": `export const key = "${key}";\n`,
      "src/keys.js": `export const token = "${fake("gh", "p_", "a".repeat(36))}";\n`,
    });
    const result = mechanicalReview(task(), changes);
    expect(result.passed).toBe(false);
    expect(result.findings.map((finding) => [finding.file, finding.message])).toEqual([
      [
        "src/config.js",
        "Adds what looks like a credential (AWS access key); read it from the environment instead.",
      ],
      [
        "src/keys.js",
        "Adds what looks like a credential (GitHub token); read it from the environment instead.",
      ],
    ]);
  });

  it("fails a task with tests: required until the change touches a test file", async () => {
    const untested = await changedRepo({ "src/config.js": "export const a = 1;\n" });
    expect(mechanicalReview(task({ tests: "required" }), untested).findings).toEqual([
      {
        severity: "blocker",
        message:
          "The task requires tests (tests: required), but the change does not touch any test file.",
      },
    ]);
    const tested = await changedRepo({
      "src/config.js": "export const a = 1;\n",
      "test/config.test.js": "// more tests\n",
    });
    expect(mechanicalReview(task({ tests: "required" }), tested).passed).toBe(true);
  });

  it("reports files outside the Scope as a finding that does not block", async () => {
    const changes = await changedRepo({
      "src/config.js": "export const a = 1;\n",
      "README.md": "# changed\n",
      "src/other.js": "export {};\n",
    });
    expect(mechanicalReview(task(), changes)).toEqual({
      passed: true,
      findings: [
        { severity: "major", message: "Changed outside the task's Scope: README.md, src/other.js" },
      ],
    });
  });
});
