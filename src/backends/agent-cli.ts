import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { UserError } from "../core/errors.js";
import { readTextIfExists, writeText } from "../core/fs.js";
import { baePaths } from "../core/paths.js";
import { type CommandResult, runCommand, runInteractive } from "../core/process.js";
import { t } from "../i18n/index.js";
import type { Access, Backend, RunOptions } from "./types.js";

export type AgentName = "claude" | "opencode" | "codex" | "gemini";

export type AgentSpec = {
  name: AgentName;
  command: string;
  headless(access: Access, outputFile: string): string[];
  interactive(instruction: string): string[];
  readsOutputFile?: boolean;
};

export type ProcessRunner = {
  run: typeof runCommand;
  interactive: typeof runInteractive;
};

const STDIN_INSTRUCTION = "Follow the instructions above exactly.";
const ERROR_TAIL = 2_000;

export const AGENT_SPECS: Record<AgentName, AgentSpec> = {
  claude: {
    name: "claude",
    command: "claude",
    headless: (access) => [
      "-p",
      "--output-format",
      "text",
      "--no-session-persistence",
      "--permission-prompts",
      "none",
      ...(access === "read" ? ["--tools", "Read,Grep,Glob"] : ["--permission-mode", "acceptEdits"]),
    ],
    interactive: (instruction) => [instruction],
  },
  opencode: {
    name: "opencode",
    command: "opencode",
    headless: (access) => ["run", ...(access === "read" ? ["--agent", "plan"] : [])],
    interactive: (instruction) => ["--prompt", instruction],
  },
  codex: {
    name: "codex",
    command: "codex",
    headless: (access, outputFile) => [
      "exec",
      "--color",
      "never",
      "--sandbox",
      access === "read" ? "read-only" : "workspace-write",
      ...(access === "read" ? ["--skip-git-repo-check"] : []),
      "--output-last-message",
      outputFile,
      "-",
    ],
    interactive: (instruction) => [instruction],
    readsOutputFile: true,
  },
  gemini: {
    name: "gemini",
    command: "gemini",
    headless: (access) => [
      "--output-format",
      "text",
      "--approval-mode",
      access === "read" ? "plan" : "auto_edit",
      "--prompt",
      STDIN_INSTRUCTION,
    ],
    interactive: (instruction) => ["--prompt-interactive", instruction],
  },
};

export const defaultRunner: ProcessRunner = { run: runCommand, interactive: runInteractive };

export function createAgentBackend(spec: AgentSpec, runner = defaultRunner): Backend {
  return {
    name: spec.name,
    run: (prompt, options) =>
      options.interactive
        ? runSession(spec, runner, prompt, options)
        : runHeadless(spec, runner, prompt, options),
  };
}

async function runHeadless(
  spec: AgentSpec,
  runner: ProcessRunner,
  prompt: string,
  options: RunOptions,
): Promise<string> {
  const tmp = baePaths(options.cwd).tmp;
  const outputFile = join(tmp, `${spec.name}-output.md`);
  if (spec.readsOutputFile) await mkdir(tmp, { recursive: true });
  const args = spec.headless(options.access ?? "read", outputFile);
  const result = await runner.run(spec.command, args, {
    cwd: options.cwd,
    input: prompt,
    onStdout: options.stream,
  });
  assertSucceeded(spec, result);
  if (!spec.readsOutputFile) return result.stdout;
  return (await readTextIfExists(outputFile)) ?? result.stdout;
}

async function runSession(
  spec: AgentSpec,
  runner: ProcessRunner,
  prompt: string,
  options: RunOptions,
): Promise<string> {
  const promptFile = join(baePaths(options.cwd).tmp, "prompt.md");
  await writeText(promptFile, prompt);
  const path = relative(options.cwd, promptFile).split("\\").join("/");
  const instruction = `Read ${path} and carry out the task it describes. It is your complete task prompt.`;
  const result = await runner.interactive(spec.command, spec.interactive(instruction), {
    cwd: options.cwd,
  });
  if (result.notFound) throw new UserError(t("backend.notInstalled", { command: spec.command }));
  return "";
}

function assertSucceeded(spec: AgentSpec, result: CommandResult): void {
  if (result.notFound) throw new UserError(t("backend.notInstalled", { command: spec.command }));
  if (result.exitCode === 0) return;
  const details = (result.stderr.trim() || result.stdout.trim()).slice(-ERROR_TAIL);
  throw new UserError(
    t("backend.failed", { command: spec.command, code: result.exitCode, details }),
  );
}
