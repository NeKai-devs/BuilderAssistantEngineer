import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_SPECS, type ProcessRunner } from "../../src/backends/agent-cli.js";
import { createBackend } from "../../src/backends/index.js";
import { EnvironmentError } from "../../src/core/errors.js";
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
          "stream-json",
          "--verbose",
          "--no-session-persistence",
          "--permission-prompts",
          "none",
          "--tools",
          "Read,Grep,Glob",
          "--setting-sources",
          "user",
          "--strict-mcp-config",
          "--disable-slash-commands",
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

  it("allows the task's commands when claude or gemini may edit, and only then", async () => {
    const allow = ["npm test", "npm install"];
    const claude = AGENT_SPECS.claude.headless("edit", "", allow);
    const rules = claude.slice(
      claude.indexOf("--allowedTools") + 1,
      claude.indexOf("--permission-mode"),
    );
    expect(rules).toEqual([
      "Bash(npm test)",
      "Bash(npm test *)",
      "Bash(npm install)",
      "Bash(npm install *)",
    ]);
    expect(AGENT_SPECS.claude.headless("read", "", allow)).not.toContain("--allowedTools");
    expect(AGENT_SPECS.claude.headless("edit", "", [])).not.toContain("--allowedTools");
    const gemini = AGENT_SPECS.gemini.headless("edit", "", allow);
    expect(gemini.slice(gemini.indexOf("--allowed-tools") + 1, gemini.indexOf("--prompt"))).toEqual(
      ["run_shell_command(npm test)", "run_shell_command(npm install)"],
    );
    expect(AGENT_SPECS.gemini.headless("read", "", allow)).not.toContain("--allowed-tools");
    expect(AGENT_SPECS.codex.headless("edit", "out.md", allow).join(" ")).not.toContain("npm");
    expect(AGENT_SPECS.opencode.headless("edit", "", allow)).toEqual(["run"]);
  });

  it("reports the commands claude was not allowed to run", async () => {
    const stdout = JSON.stringify({
      type: "result",
      result: "Blocked.",
      permission_denials: [
        { tool_name: "Bash", tool_input: { command: "npm --version" } },
        { tool_name: "Bash", tool_input: { command: "npm --version" } },
        { tool_name: "WebFetch", tool_input: { url: "https://example.com" } },
      ],
    });
    const infos: { denied?: string[] }[] = [];
    await createBackend("claude", { runner: fakeRunner({ stdout }).runner }).run("P", {
      cwd: await tempDir(),
      access: "edit",
      onInfo: (info) => infos.push(info),
    });
    expect(infos[0]?.denied).toEqual(["npm --version"]);
  });

  it("joins an answer that claude split over several messages after its last tool call", async () => {
    const assistant = (id: string, content: unknown[]) =>
      JSON.stringify({ type: "assistant", message: { id, content } });
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init" }),
      assistant("m1", [{ type: "text", text: "Let me read the repo." }]),
      assistant("m1", [{ type: "tool_use", name: "Read", input: {} }]),
      assistant("m2", [{ type: "text", text: "<<<SUMMARY>>>\nfirst half, " }]),
      JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "Resume." }] } }),
      assistant("m3", [{ type: "text", text: "second half\n<<<END SUMMARY>>>" }]),
      JSON.stringify({
        type: "result",
        result: "second half\n<<<END SUMMARY>>>",
        stop_reason: "end_turn",
      }),
    ].join("\n");
    const { runner } = fakeRunner({ stdout });
    const output = await createBackend("claude", { runner }).run("P", { cwd: await tempDir() });
    expect(output).toBe("<<<SUMMARY>>>\nfirst half, second half\n<<<END SUMMARY>>>");
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
    expect(AGENT_SPECS.opencode.headless("read", "", [])).toEqual(["run", "--agent", "plan"]);
    expect(AGENT_SPECS.gemini.headless("read", "", [])).toContain("plan");
    expect(AGENT_SPECS.codex.headless("read", "out.md", [])).toEqual([
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

  it("treats a failed agent CLI as an environment problem, but not a timeout", async () => {
    const cwd = await tempDir();
    const session = fakeRunner({ exitCode: 1 }).runner;
    const opened = createBackend("claude", { runner: session }).run("TASK", {
      cwd,
      interactive: true,
    });
    await expect(opened).rejects.toBeInstanceOf(EnvironmentError);
    await expect(opened).rejects.toThrow(
      "`claude` exited with code 1 before the task was finished",
    );
    const exited = fakeRunner({ exitCode: 0 }).runner;
    await expect(
      createBackend("claude", { runner: exited }).run("TASK", { cwd, interactive: true }),
    ).resolves.toBe("");
    const loggedOut = fakeRunner({ exitCode: 1, stderr: "Invalid API key" }).runner;
    await expect(
      createBackend("claude", { runner: loggedOut }).run("P", { cwd }),
    ).rejects.toBeInstanceOf(EnvironmentError);
    const missing = fakeRunner({ notFound: true, exitCode: -1 }).runner;
    await expect(
      createBackend("opencode", { runner: missing }).run("P", { cwd, interactive: true }),
    ).rejects.toBeInstanceOf(EnvironmentError);
    const slow = fakeRunner({ exitCode: -1, timedOut: true }).runner;
    const timedOut = createBackend("claude", { runner: slow }).run("P", { cwd, timeoutMs: 60_000 });
    await expect(timedOut).rejects.toThrow("did not finish within 1 minutes");
    await expect(timedOut).rejects.not.toBeInstanceOf(EnvironmentError);
  });

  it("says whether the agent CLI is installed", async () => {
    const backend = createBackend("claude");
    expect(typeof (await backend.available?.())).toBe("boolean");
    expect(createBackend("manual").available).toBeUndefined();
  });

  it("gives the read-only analyst and reviewer none of the user's MCP connectors or skills (audit A8)", async () => {
    const cwd = await tempDir();
    const read = fakeRunner();
    await createBackend("claude", { runner: read.runner }).run("P", { cwd, access: "read" });
    expect(read.calls[0]?.args).toEqual(
      expect.arrayContaining(["--strict-mcp-config", "--disable-slash-commands"]),
    );
    expect(read.calls[0]?.args).not.toContain("--mcp-config");
    const edit = fakeRunner();
    await createBackend("claude", { runner: edit.runner }).run("P", { cwd, access: "edit" });
    expect(edit.calls[0]?.args).not.toContain("--strict-mcp-config");
  });
});
