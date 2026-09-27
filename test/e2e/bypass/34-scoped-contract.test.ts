import { describe, expect, it } from "vitest";
import { agent, bypassRepo, next, REVIEW_PASS, read, statusOf } from "./harness.js";
import { SUITE_FILES, TEST_CMD } from "./suite-fixture.js";

const SCOPE = [
  "- `src/`",
  "- `package.json`",
  "- `tsconfig.json`",
  "- `eslint.config.js`",
  "- `vitest.config.ts`",
  "- `.gitignore`",
].join("\n");
const PACKAGE = (lint: string) =>
  `${JSON.stringify({ scripts: { test: TEST_CMD, lint } }, null, 2)}\n`;

const toolingRepo = () =>
  bypassRepo({
    task: { scope: SCOPE },
    files: {
      ...SUITE_FILES(),
      "package.json": PACKAGE("eslint ."),
      "tsconfig.json": '{ "compilerOptions": { "strict": true } }\n',
      "eslint.config.js": "export default [];\n",
      "vitest.config.ts": "export default { test: {} };\n",
      ".gitignore": "dist/\n",
    },
    config: { commands: { test: TEST_CMD } },
  });

describe("bypass 34: a task may change the check files its Scope lists, but not weaken them", () => {
  it("keeps a tooling change to files the Scope lists and ends done", async () => {
    const cwd = await toolingRepo();
    const tooling = agent(cwd, {
      "package.json": PACKAGE("eslint . && prettier --check ."),
      "tsconfig.json": '{ "compilerOptions": { "strict": true, "module": "NodeNext" } }\n',
      "eslint.config.js":
        'import js from "@eslint/js";\nexport default [js.configs.recommended];\n',
      ".gitignore": "dist/\nnode_modules/\n",
    });
    const run = await next(cwd, ["--yes"], [tooling, REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(await statusOf(cwd)).toBe("done");
    expect(await read(cwd, ".gitignore")).toBe("dist/\nnode_modules/\n");
    expect(run.calls[1]?.prompt).toContain(
      "package.json: Changed scripts.lint, which the checks run.",
    );
    expect(run.calls[1]?.prompt).toContain(
      `- \`${TEST_CMD}\` (test): exit 0; 2 passed, 0 failed, 0 skipped; passed`,
    );
    expect(run.calls[1]?.prompt).toContain("exit 0 (every line exited 0)");
  });

  it("restores a listed script that stops running the tool it ran", async () => {
    const cwd = await toolingRepo();
    const run = await next(
      cwd,
      ["--yes"],
      [agent(cwd, { "package.json": PACKAGE("echo lint ok") }), REVIEW_PASS],
    );
    expect(run.code).toBe(1);
    expect(run.log).toContain("It stops running what these scripts ran: scripts.lint (eslint).");
    expect(await read(cwd, "package.json")).toBe(PACKAGE("eslint ."));
  });

  it("lets a listed test script move to another test runner the gate reads", async () => {
    const cwd = await toolingRepo();
    const scripts = { test: "node jest.js", lint: "eslint ." };
    const move = agent(cwd, { "package.json": `${JSON.stringify({ scripts }, null, 2)}\n` });
    const run = await next(cwd, ["--yes"], [move, REVIEW_PASS]);
    expect(run.log).not.toContain("It stops running what these scripts ran");
    expect(run.code).toBe(0);
  });

  it("restores a listed runner config that starts leaving tests out", async () => {
    const cwd = await toolingRepo();
    const exclude = "export default { test: { exclude: ['tests/b.test.js'] } };\n";
    const run = await next(
      cwd,
      ["--yes"],
      [agent(cwd, { "vitest.config.ts": exclude }), REVIEW_PASS],
    );
    expect(run.code).toBe(1);
    expect(run.log).toContain("It adds settings that leave tests out (test exclude).");
    expect(await read(cwd, "vitest.config.ts")).toBe("export default { test: {} };\n");
  });

  it("keeps a listed memory file change and restores a new test hook the Scope does not allow", async () => {
    const cwd = await bypassRepo({
      task: { scope: "- `src/`\n- `CLAUDE.md`" },
      files: {
        ...SUITE_FILES(),
        "CLAUDE.md": "@AGENTS.md\n",
        "package.json": PACKAGE("eslint ."),
      },
      config: { commands: { test: TEST_CMD } },
    });
    const hook = `${JSON.stringify({ scripts: { pretest: "node tools/swap.js", test: TEST_CMD, lint: "eslint ." } }, null, 2)}\n`;
    const work = agent(cwd, {
      "CLAUDE.md": "@AGENTS.md\n\nRun the tests first.\n",
      "package.json": hook,
    });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      "package.json: Changed scripts.pretest, which the checks run. Restored.",
    );
    expect(await read(cwd, "CLAUDE.md")).toContain("Run the tests first.");
    expect(await read(cwd, "package.json")).toBe(PACKAGE("eslint ."));
  });

  it("does not judge build output the build writes again as the task's own code", async () => {
    const cwd = await bypassRepo({
      task: { scope: "- `src/`" },
      files: {
        "src/feature.js": "// eslint-disable-next-line no-console\nconsole.log(1);\n",
        "build.js":
          'require("fs").mkdirSync("dist",{recursive:true});require("fs").copyFileSync("src/feature.js","dist/feature.js");\n',
      },
      config: { commands: { build: "node build.js" } },
    });
    const work = agent(cwd, {
      "src/feature.js": "// eslint-disable-next-line no-console\nconsole.log(2);\n",
    });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.log).not.toContain("dist/feature.js");
    expect(run.code).toBe(0);
  });
});
