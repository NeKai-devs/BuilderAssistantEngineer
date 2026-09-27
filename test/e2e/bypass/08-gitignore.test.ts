import { describe, expect, it } from "vitest";
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

  it("needs the Scope and an accepted finding for other files that decide how checks run", async () => {
    const cwd = await bypassRepo({
      files: { ".npmrc": "fund=false\n" },
      task: { scope: "- `src/feature.ts`\n- `.npmrc`" },
    });
    const edit = agent(cwd, {
      "src/feature.ts": "export const f = 1;\n",
      ".npmrc": "fund=false\naudit=false\n",
    });
    const first = await next(cwd, ["--yes"], [edit]);
    expect(first.code).toBe(1);
    const id = /\((contract-[0-9a-f]{8})\) \.npmrc/.exec(first.log)?.[1] ?? "";
    expect(id).not.toBe("");
    const second = await next(cwd, ["--yes", "--accept-finding", id], [edit, REVIEW_PASS]);
    expect(second.code).toBe(0);
    expect(await read(cwd, ".npmrc")).toContain("audit=false");
    expect(second.log).toContain(`(${id}) .npmrc: Changed a package manager or tool setting`);
  });
});
