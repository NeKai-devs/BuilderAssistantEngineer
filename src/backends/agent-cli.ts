import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { UserError } from "../core/errors.js";
import { readTextIfExists, writeText } from "../core/fs.js";
import { asRecord, parseObject } from "../core/json.js";
import { baePaths } from "../core/paths.js";
import { type CommandResult, runCommand, runInteractive } from "../core/process.js";
import { t } from "../i18n/index.js";
import type { Access, Backend, RunInfo, RunOptions } from "./types.js";

export type AgentName = "claude" | "opencode" | "codex" | "gemini";

export type AgentSpec = {
  name: AgentName;
  command: string;
  headless(access: Access, outputFile: string): string[];
  interactive(instruction: string): string[];
  readsOutputFile?: boolean;
  jsonOutput?: boolean;
  parse?: (result: CommandResult) => Parsed;
};

type Parsed = { text: string; info: RunInfo };

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
      "json",
      "--no-session-persistence",
      "--permission-prompts",
      "none",
      ...(access === "read" ? ["--tools", "Read,Grep,Glob"] : ["--permission-mode", "acceptEdits"]),
    ],
    interactive: (instruction) => [instruction],
    jsonOutput: true,
    parse: parseClaudeJson,
  },
  opencode: {
    name: "opencode",
    command: "opencode",
    headless: (access) => ["run", ...(access === "read" ? ["--agent", "plan"] : [])],
    interactive: (instruction) => ["--prompt", instruction],
    parse: (result) => ({
      text: result.stdout,
      info: { model: stderrModel(result, /^> \S+ · (.+)$/m) },
    }),
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
    parse: (result) => ({
      text: result.stdout,
      info: { model: stderrModel(result, /^model:\s*(.+)$/m) },
    }),
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
    onStdout: spec.jsonOutput ? undefined : options.stream,
  });
  assertSucceeded(spec, result);
  const parsed = spec.parse?.(result) ?? { text: result.stdout, info: {} };
  options.onInfo?.(parsed.info);
  if (spec.jsonOutput) options.stream?.(parsed.text);
  if (!spec.readsOutputFile) return parsed.text;
  return (await readTextIfExists(outputFile)) ?? parsed.text;
}

function parseClaudeJson(result: CommandResult): Parsed {
  const data = parseObject(result.stdout);
  if (!data || typeof data.result !== "string") return { text: result.stdout, info: {} };
  const models = Object.keys(asRecord(data.modelUsage));
  const cost = typeof data.total_cost_usd === "number" ? data.total_cost_usd : undefined;
  return { text: data.result, info: { model: models.join(", ") || undefined, costUsd: cost } };
}

function stderrModel(result: CommandResult, pattern: RegExp): string | undefined {
  return pattern.exec(stripVTControlCharacters(result.stderr))?.[1]?.trim() || undefined;
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
