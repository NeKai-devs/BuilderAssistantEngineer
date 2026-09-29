import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { writeConfig, writeInterview } from "../../src/config/store.js";
import { UserError } from "../../src/core/errors.js";
import { git } from "../../src/core/git.js";
import { fakePrompter } from "../fakes.js";
import { gitCommitAll, tempDir } from "../helpers.js";

describe("bae's scratch files never reach a commit (audit A9)", () => {
  it("ignores .bae/tmp before a plan that fails writes its report there", async () => {
    const cwd = await tempDir();
    await writeConfig(cwd, {
      version: 1,
      mode: "greenfield",
      backend: "claude",
      targets: ["claude-code"],
      lang: "en",
    });
    await writeInterview(cwd, "# Interview\n\nA tool.\n");
    await gitCommitAll(cwd, "cloned with a config and no .gitignore");
    const code = await main(["node", "bae", "plan", "--yes"], cwd, {
      prompter: fakePrompter([]).prompter,
      createBackend: () => ({
        name: "claude",
        run: async () => {
          throw new UserError("offline");
        },
      }),
      env: {},
      print: () => {},
    });
    expect(code).toBe(1);
    const status = (await git(cwd, ["status", "--porcelain", "--untracked-files=all"])) ?? "";
    expect(status).toContain(".gitignore");
    expect(status).not.toContain(".bae/tmp");
  });
});
