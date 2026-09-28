import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeFiles } from "../../helpers.js";
import { agent, bypassRepo, fake, next, REVIEW_PASS, read } from "./harness.js";

const KEY = () => `export const key = "${fake("AKIA", "ABCDEFGHIJKLMNOP")}";\n`;

describe("bypass 08: an ignore file cannot hide a change from the checks", () => {
  it("restores an edited .gitignore and still sees the file it tried to hide", async () => {
    const cwd = await bypassRepo({ files: { ".gitignore": "node_modules/\n" } });
    const cheat = agent(cwd, {
      "src/feature.ts": "export const f = 1;\n",
      ".gitignore": "node_modules/\nsrc/hidden.ts\n",
      "src/hidden.ts": KEY(),
    });
    const run = await next(cwd, ["--yes"], [cheat, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      ".gitignore: Changed an ignore file, which decides what the review sees. Restored.",
    );
    expect(await read(cwd, ".gitignore")).toContain("node_modules/\n");
    expect(await read(cwd, ".gitignore")).not.toContain("hidden");
  });

  it("uses the ignore rules captured before the task, so a new nested .gitignore hides nothing", async () => {
    const cwd = await bypassRepo();
    const cheat = agent(cwd, {
      "src/feature.ts": "export const f = 1;\n",
      "src/secret/.gitignore": "*\n",
      "src/secret/key.ts": KEY(),
    });
    const run = await next(cwd, ["--yes"], [cheat, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toMatch(/src\/secret\/key\.ts: Adds what looks like a credential/);
    expect(run.calls).toHaveLength(1);
  });

  it("keeps the change when the Scope lists the .gitignore", async () => {
    const cwd = await bypassRepo({
      files: { ".gitignore": "node_modules/\n" },
      task: { scope: "- `src/feature.ts`\n- `.gitignore`" },
    });
    const edit = agent(cwd, {
      "src/feature.ts": "export const f = 1;\n",
      ".gitignore": "node_modules/\ncoverage/\n",
    });
    const run = await next(cwd, ["--yes"], [edit, REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(await read(cwd, ".gitignore")).toContain("coverage/");
    expect(run.log).toContain("The task's Scope lists this file, so the change stays");
  });

  it("needs an accepted finding for a listed tool setting that changes how the checks start", async () => {
    const cwd = await bypassRepo({
      files: { ".npmrc": "fund=false\n" },
      task: { scope: "- `src/feature.ts`\n- `.npmrc`" },
    });
    const edit = agent(cwd, {
      "src/feature.ts": "export const f = 1;\n",
      ".npmrc": "fund=false\nscript-shell=./shell.sh\n",
    });
    const first = await next(cwd, ["--yes"], [edit]);
    expect(first.code).toBe(1);
    const id = /\((contract-[0-9a-f]{8})\) \.npmrc/.exec(first.log)?.[1] ?? "";
    expect(id).not.toBe("");
    const second = await next(cwd, ["--yes", "--accept-finding", id], [edit, REVIEW_PASS]);
    expect(second.code).toBe(0);
    expect(await read(cwd, ".npmrc")).toContain("script-shell");
    expect(second.log).toContain(`(${id}) .npmrc: Changed a package manager or tool setting`);
  });

  it("keeps a cache that a tool ignores during the task out of the review, but still scans it", async () => {
    const cwd = await bypassRepo({ task: { scope: "- `src/feature.ts`" } });
    const exclude = async (lines: string) => {
      const path = join(cwd, ".git", "info", "exclude");
      await writeFile(path, `${await readFile(path, "utf8").catch(() => "")}${lines}`);
    };
    const hook = agent(cwd, { "src/feature.ts": "export const f = 1;\n" }, async () => {
      await writeFiles(cwd, { ".tool/hook.cache.json": '{"session":"abc"}\n' });
      await exclude(".tool/hook.cache.json\n");
    });
    const run = await next(cwd, ["--yes"], [hook, REVIEW_PASS]);
    expect(run.code).toBe(0);
    expect(run.log).not.toContain("Changed outside the task's Scope");
    expect(run.calls[1]?.prompt).toContain("ignore rules added during the task leave out");
    const hidden = await bypassRepo({ task: { scope: "- `src/feature.ts`" } });
    const cheat = agent(
      hidden,
      { "src/feature.ts": "export const f = 1;\n", "src/k.ts": KEY() },
      async () => {
        const path = join(hidden, ".git", "info", "exclude");
        await writeFile(path, `${await readFile(path, "utf8").catch(() => "")}src/k.ts\n`);
      },
    );
    const blocked = await next(hidden, ["--yes"], [cheat, REVIEW_PASS]);
    expect(blocked.code).toBe(1);
    expect(blocked.log).toContain("src/k.ts: Adds what looks like a credential");
  });

  it("still reviews a file in a code folder that a rule added during the task ignores", async () => {
    const cwd = await bypassRepo({ task: { scope: "- `src/feature.ts`" } });
    const work = agent(cwd, { "src/feature.ts": "export const f = 1;\n" }, async () => {
      await writeFiles(cwd, { "src/settings.json": '{"mode":"UNREVIEWED_MARKER"}\n' });
      const path = join(cwd, ".git", "info", "exclude");
      await writeFile(path, `${await readFile(path, "utf8").catch(() => "")}src/settings.json\n`);
    });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.log).toContain("Changed outside the task's Scope: src/settings.json");
    expect(run.calls[1]?.prompt).toContain("UNREVIEWED_MARKER");
    expect(run.calls[1]?.prompt).not.toContain("ignore rules added during the task leave out");
  });
});
