import { describe, expect, it } from "vitest";
import { vitest } from "../../fake-vitest.js";
import { agent, bypassRepo, next, REVIEW_PASS, read, statusOf } from "./harness.js";

describe("bypass 35: Verification runs what the plan wrote, where it wrote it", () => {
  it("runs a suite command again after a cd instead of reusing the root result", async () => {
    const test = vitest();
    const cwd = await bypassRepo({
      task: { scope: "- `web/`", command: `cd web\n${test}` },
      files: { "web/vitest.js": "process.exit(require('fs').existsSync('broken.txt') ? 1 : 0);\n" },
      config: { commands: { test } },
    });
    const run = await next(cwd, ["--yes"], [agent(cwd, { "web/broken.txt": "x\n" }), REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(`Verification failed: \`${test}\` exited with 1.`);
    expect(await statusOf(cwd)).toBe("in_progress");
  });

  it.each([
    ["a quoted string over several lines", 'node -e "\n  process.exit(0)\n"'],
    ["a release word inside a pattern", 'grep -q "owner" src/feature.ts'],
    [
      "if, for and case blocks",
      'if test -f src/feature.ts; then echo ok; fi\nfor f in src/feature.ts; do test -f "$f"; done\ncase "$HOME" in\n  *) test -n "$HOME";;\nesac',
    ],
    [
      "wrappers and cleanup",
      'timeout 60 node -e "process.exit(0)"\nrm -f tmp.txt\nset -x\ntest -f src/feature.ts || exit 1',
    ],
    ["a shell script of the repository", "sh scripts/check.sh"],
  ])("runs correct work unattended with %s", async (_name, command) => {
    const cwd = await bypassRepo({
      task: { command },
      files: { "scripts/check.sh": "test -f src/feature.ts\n" },
    });
    const run = await next(
      cwd,
      ["--headless", "--yes"],
      [agent(cwd, { "src/feature.ts": "export const owner = 1;\n" }), REVIEW_PASS],
    );
    expect(run.log).not.toContain("is not on the list of commands");
    expect(run.code).toBe(0);
    expect(await statusOf(cwd)).toBe("done");
  });

  it("does not count a command that --allow-skip left out of the suite as already failing", async () => {
    const own = "node scripts/run-tests.js";
    const cwd = await bypassRepo({
      task: { command: own },
      files: { "scripts/run-tests.js": "process.exit(0);\n" },
      config: { commands: { test: own } },
    });
    const work = agent(cwd, { "src/feature.ts": "export const f = 1;\n" });
    const run = await next(cwd, ["--yes", "--allow-skip"], [work, REVIEW_PASS]);
    expect(run.log).not.toContain("only runs commands that already failed");
    expect(run.code).toBe(0);
  });

  it("lets a task edit the .gitignore that bae created itself", async () => {
    const cwd = await bypassRepo({
      task: { scope: "- `src/feature.ts`", command: "grep -qx 'bin/' .gitignore" },
    });
    const work = agent(cwd, { "src/feature.ts": "export const f = 1;\n" }, async () => {
      const current = await read(cwd, ".gitignore").catch(() => "");
      const { writeFiles } = await import("../../helpers.js");
      await writeFiles(cwd, { ".gitignore": `${current}bin/\n` });
    });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.log).not.toContain(".gitignore: Changed an ignore file");
    expect(run.code).toBe(0);
  });
});
