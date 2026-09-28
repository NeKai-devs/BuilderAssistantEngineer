import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { bashPath } from "../../../src/core/bash.js";
import { runVerification } from "../../../src/tasks/verify.js";
import { tempDir, writeFiles } from "../../helpers.js";
import { agent, bypassRepo, fake, next, REVIEW_PASS } from "./harness.js";

describe("bypass 31: Verification, change detection and secrets close their gaps", () => {
  it.each([
    ['grep -q missing file.txt && echo ok\nnode -e "process.exit(0)"'],
    ['! node -e "process.exit(0)"\nnode -e "process.exit(0)"'],
  ])("fails a check that fails inside a list or a negation: %s", async (block) => {
    const cwd = await tempDir();
    await writeFiles(cwd, { "file.txt": "present\n" });
    const result = await runVerification(cwd, block.split("\n"), {
      bash: (await bashPath()) ?? "bash",
    });
    expect(result.passed).toBe(false);
  });

  it("keeps heredocs and conditionals intact", async () => {
    const cwd = await tempDir();
    const block = [
      "cat > out.txt <<EOF",
      "line one",
      "EOF",
      "if grep -q one out.txt; then",
      "  echo found",
      "fi",
    ];
    const result = await runVerification(cwd, block, { bash: (await bashPath()) ?? "bash" });
    expect(result.passed).toBe(true);
  });

  it("sees files inside a nested repository", async () => {
    const cwd = await bypassRepo();
    const nested = agent(
      cwd,
      { "vendored/lib/key.ts": `export const k = "${fake("AKIA", "ABCDEFGHIJKLMNOP")}";\n` },
      async () => {
        execSync("git init -q", { cwd: `${cwd}/vendored/lib` });
      },
    );
    const run = await next(cwd, ["--yes"], [nested, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      "vendored/lib/key.ts: Adds what looks like a credential (AWS access key)",
    );
  });

  it("finds an unquoted password in YAML", async () => {
    const cwd = await bypassRepo();
    const work = agent(cwd, {
      "src/feature.ts": "x\n",
      "config/db.yml": `db_password: ${fake("Pr0d", "Secret99x")}\n`,
    });
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      "config/db.yml: Adds what looks like a credential (hardcoded password or key)",
    );
  });

  it("shows minified files to the reviewer instead of hiding them", async () => {
    const cwd = await bypassRepo();
    const work = agent(cwd, {
      "src/feature.ts": "x\n",
      "src/auth.min.js": "window.isAdmin=function(){return true};// MIN_MARKER\n",
    });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(run.calls[1]?.prompt).toContain("MIN_MARKER");
  });
});
