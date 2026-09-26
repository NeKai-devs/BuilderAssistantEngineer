import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_SPECS, type ProcessRunner } from "../../src/backends/agent-cli.js";
import { createBackend } from "../../src/backends/index.js";
import type { CommandResult } from "../../src/core/process.js";
import { tempDir, writeFiles } from "../helpers.js";

type Call = { file: string; args: string[]; input?: string; mode: "run" | "interactive" };

function fakeRunner(
  result: Partial<CommandResult> = {},
  onRun?: (args: string[]) => Promise<void>,
) {
  const calls: Call[] = [];
  const done = { exitCode: 0, stdout: "OUTPUT", stderr: "", notFound: false, ...result };
  const runner: ProcessRunner = {
    run: async (file, args, options) => {
      calls.push({ file, args, input: options.input, mode: "run" });
      options.onStdout?.(done.stdout);
      await onRun?.(args);
      return done;
    },
    interactive: async (file, args) => {
      calls.push({ file, args, mode: "interactive" });
      return done;
    },
  };
  return { runner, calls };
}

describe("agent CLI backends", () => {
  it("runs claude headless and read-only with the prompt on stdin", async () => {
    const { runner, calls } = fakeRunner();
    const chunks: string[] = [];
    const backend = createBackend("claude", { runner });
    const output = await backend.run("PROMPT", {
      cwd: await tempDir(),
      stream: (c) => chunks.push(c),
    });
    expect(output).toBe("OUTPUT");
    expect(chunks).toEqual(["OUTPUT"]);
    expect(calls).toEqual([
      {
        file: "claude",
        args: [
          "-p",
          "--output-format",
          "json",
          "--no-session-persistence",
          "--permission-prompts",
          "none",
          "--tools",
          "Read,Grep,Glob",
          "--setting-sources",
          "user",
        ],
        input: "PROMPT",
        mode: "run",
      },
    ]);
  });

  it("reads claude's JSON result, model, cost and whether the output limit cut it", async () => {
    const stdout = JSON.stringify({
      type: "result",
      result: "PLAN",
      total_cost_usd: 0.25,
      stop_reason: "max_tokens",
      modelUsage: { "claude-opus-5-5": {} },
    });
    const { runner } = fakeRunner({ stdout });
    const infos: unknown[] = [];
    const chunks: string[] = [];
    const output = await createBackend("claude", { runner }).run("P", {
      cwd: await tempDir(),
      onInfo: (info) => infos.push(info),
      stream: (chunk) => chunks.push(chunk),
    });
    expect(output).toBe("PLAN");
    expect(chunks).toEqual(["PLAN"]);
    expect(infos).toEqual([{ model: "claude-opus-5-5", costUsd: 0.25, truncated: true }]);
  });

  it("reads the model opencode prints on stderr", async () => {
    const { runner } = fakeRunner({ stdout: "TEXT", stderr: "\u001b[0m\n> plan · big-pickle\n" });
    const infos: unknown[] = [];
    const output = await createBackend("opencode", { runner }).run("P", {
      cwd: await tempDir(),
      onInfo: (info) => infos.push(info),
    });
    expect(output).toBe("TEXT");
    expect(infos).toEqual([{ model: "big-pickle" }]);
  });

  it.each([
    ["claude", ["--permission-mode", "acceptEdits"]],
    ["opencode", ["run"]],
    ["gemini", ["--approval-mode", "auto_edit"]],
  ] as const)("lets %s edit only with access=edit and never bypasses", async (name, expected) => {
    const { runner, calls } = fakeRunner();
    await createBackend(name, { runner }).run("P", { cwd: await tempDir(), access: "edit" });
    const args = calls[0]?.args ?? [];
    expect(args.join(" ")).toContain(expected.join(" "));
    expect(args.join(" ")).not.toMatch(/bypass|yolo|dangerously|--auto\b/);
  });

  it("uses read-only modes for every agent by default", () => {
    expect(AGENT_SPECS.opencode.headless("read", "")).toEqual(["run", "--agent", "plan"]);
    expect(AGENT_SPECS.gemini.headless("read", "")).toContain("plan");
    expect(AGENT_SPECS.codex.headless("read", "out.md")).toEqual([
      "exec",
      "--color",
      "never",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--output-last-message",
      "out.md",
      "-",
    ]);
  });

  it("reads codex's final message from its output file", async () => {
    const cwd = await tempDir();
    const { runner } = fakeRunner({ stdout: "progress noise" }, async (args) => {
      const file = args[args.indexOf("--output-last-message") + 1] ?? "";
      await writeFiles(cwd, {
        [file
          .slice(cwd.length + 1)
          .split("\\")
          .join("/")]: "FINAL",
      });
    });
    expect(await createBackend("codex", { runner }).run("P", { cwd })).toBe("FINAL");
  });

  it("opens an interactive session pointing at a prompt file", async () => {
    const cwd = await tempDir();
    const { runner, calls } = fakeRunner();
    const output = await createBackend("gemini", { runner }).run("TASK", {
      cwd,
      interactive: true,
    });
    expect(output).toBe("");
    expect(calls[0]?.mode).toBe("interactive");
    expect(calls[0]?.args[0]).toBe("--prompt-interactive");
    expect(calls[0]?.args[1]).toContain(".bae/tmp/prompt.md");
    expect(await readFile(join(cwd, ".bae", "tmp", "prompt.md"), "utf8")).toBe("TASK");
  });

  it("explains a missing CLI and surfaces failures", async () => {
    const cwd = await tempDir();
    const missing = fakeRunner({ notFound: true, exitCode: -1 }).runner;
    await expect(createBackend("codex", { runner: missing }).run("P", { cwd })).rejects.toThrow(
      "`codex` is not installed",
    );
    const failing = fakeRunner({ exitCode: 2, stderr: "auth required" }).runner;
    await expect(createBackend("claude", { runner: failing }).run("P", { cwd })).rejects.toThrow(
      /code 2:\nauth required/,
    );
  });
});
