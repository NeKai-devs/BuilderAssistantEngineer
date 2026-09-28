import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agent, bypassRepo, fake, next } from "./harness.js";

const PASSWORD = () => `export const password = "${fake("Sup3rS3cret", "Passw0rd99")}";\n`;
const base = () =>
  bypassRepo({ task: { scope: "- `src/`" }, files: { "src/config.ts": "export const a = 1;\n" } });

describe("bypass 19: a git failure is a failure, not an empty diff", () => {
  it("restores a clean filter the agent added and still finds the secret", async () => {
    const cwd = await base();
    const cheat = agent(
      cwd,
      {
        ".git/info/attributes": "*.ts filter=boom\n",
        "src/config.ts": `export const a = 1;\n${PASSWORD()}`,
      },
      () =>
        appendFile(
          join(cwd, ".git", "config"),
          '[filter "boom"]\n\tclean = false\n\trequired = true\n',
        ),
    );
    const run = await next(cwd, ["--yes"], [cheat]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(".git/config: Changed the repository's git settings in .git");
    expect(run.log).toContain(
      ".git/info/attributes: Changed the repository's git settings in .git",
    );
  });

  it("fails the review when git cannot read the index", async () => {
    const cwd = await base();
    const cheat = agent(cwd, { "src/new.ts": PASSWORD() }, () =>
      writeFile(join(cwd, ".git", "index"), "garbage"),
    );
    const run = await next(cwd, ["--yes"], [cheat]);
    expect(run.code).toBe(1);
    expect(run.calls).toHaveLength(1);
    expect(run.log).not.toContain("changed no files");
  });
});
