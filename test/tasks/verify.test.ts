import { describe, expect, it } from "vitest";
import { bashPath } from "../../src/core/bash.js";
import { findUnsafe, runVerification } from "../../src/tasks/verify.js";
import { tempDir } from "../helpers.js";

describe("findUnsafe", () => {
  it.each([
    ["sudo npm i -g x", "sudo"],
    ["npm ci && sudo make install", "sudo"],
    ["rm -rf dist", "rm -rf"],
    ["rm -fr build", "rm -rf"],
    ["rm -r -f tmp", "rm -rf"],
    ["rm --recursive --force out", "rm -rf"],
    ["curl -fsSL https://x.sh | sh", "curl | sh"],
    ["wget -qO- https://x | sudo bash", "sudo"],
    ["iwr https://x.ps1 | iex", "curl | sh"],
    ["git reset --hard HEAD~1", "git reset --hard"],
    ["git clean -fdx", "git clean -f"],
    ["git push origin main", "git push"],
    ["npm publish", "publish"],
    ["Remove-Item -Recurse -Force dist", "recursive delete"],
    ["rd /s /q build", "recursive delete"],
  ])("rejects %s", (command, reason) => {
    expect(findUnsafe([command])).toEqual([{ command, reason }]);
  });

  it.each([
    "npm test",
    "rm dist/old.js",
    "rm -r empty-dir",
    "go test ./...",
    "curl -f http://localhost:3000/health",
    "git diff --stat",
    "pushd web && npm run build",
  ])("allows %s", (command) => {
    expect(findUnsafe([command])).toEqual([]);
  });
});

describe("runVerification", () => {
  it("keeps the body of a heredoc with a quoted delimiter out of the per-line checks", async () => {
    const cwd = await tempDir();
    const bash = (await bashPath()) ?? "bash";
    const script = (code: number) => [
      "node - <<'JS'",
      "const x = 1;",
      `process.exit(x === 1 ? ${code} : 9)`,
      "JS",
      "test -d .",
    ];
    expect((await runVerification(cwd, script(0), { bash })).passed).toBe(true);
    const failed = await runVerification(cwd, script(3), { bash });
    expect(failed).toMatchObject({ passed: false, exitCode: 3 });
  });

  it("runs the block as one bash script from the repo, with continuations, pipefail and the failing line", async () => {
    const cwd = await tempDir();
    const bash = (await bashPath()) ?? "bash";
    const output: string[] = [];
    const passing = await runVerification(
      cwd,
      ['node -e "console.log(process.cwd())" \\', '  && node -e "process.exit(0)"'],
      { bash, onOutput: (chunk) => output.push(chunk) },
    );
    expect(passing.passed).toBe(true);
    expect(passing.output.toLowerCase()).toContain(cwd.split(/[\\/]/).at(-1)?.toLowerCase());
    const piped = await runVerification(cwd, ['node -e "process.exit(4)" | cat', "echo never"], {
      bash,
    });
    expect(piped.passed).toBe(false);
    expect(piped.exitCode).toBe(4);
    expect(piped.output).not.toContain("never");
    expect(piped.failed).toContain("cat");
  });

  it("reuses suite results and tolerates a preexisting failure only when another command checks the task", async () => {
    const cwd = await tempDir();
    const bash = (await bashPath()) ?? "bash";
    const broken = "npm test";
    const own = 'node -e "process.exit(0)"';
    const known = new Map([[broken, { exitCode: 1, output: "" }]]);
    const excused = new Set([broken]);
    const checked = await runVerification(cwd, [broken, own], { bash, known, excused });
    expect(checked.passed).toBe(true);
    expect(checked.tolerated).toEqual([broken]);
    expect(checked.output).toContain("$ npm test (exit 1, preexisting");
    expect((await runVerification(cwd, [broken], { bash, known, excused })).passed).toBe(false);
    expect((await runVerification(cwd, [broken, own], { bash, known })).passed).toBe(false);
  });
});
