import { execa } from "execa";
import { superviseGroup } from "./group.js";
import { findExecutable } from "./which.js";

const SHELL_TIMEOUT_MS = 15 * 60_000;

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  notFound: boolean;
  timedOut?: boolean;
};

export type CommandOptions = {
  cwd: string;
  input?: string;
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
};

export async function runCommand(
  file: string,
  args: string[],
  options: CommandOptions,
): Promise<CommandResult> {
  if (!(await findExecutable(file))) return missing(file);
  const group = process.platform !== "win32";
  const subprocess = execa(file, args, {
    cwd: options.cwd,
    input: options.input,
    reject: false,
    detached: group,
    ...(group ? {} : { timeout: options.timeoutMs }),
    env: { PWD: options.cwd },
  });
  const { onStdout } = options;
  if (onStdout) subprocess.stdout?.on("data", (chunk: Buffer) => onStdout(chunk.toString()));
  const supervised = superviseGroup(subprocess, options.timeoutMs, group);
  const result = await subprocess.finally(supervised.release);
  const notFound = "code" in result && result.code === "ENOENT";
  const timedOut = Boolean(result.timedOut) || supervised.timedOut();
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.exitCode === undefined ? (result.message ?? "") : (result.stderr ?? ""),
    notFound,
    ...(timedOut ? { timedOut: true } : {}),
  };
}

export async function runInteractive(
  file: string,
  args: string[],
  options: { cwd: string },
): Promise<CommandResult> {
  if (!(await findExecutable(file))) return missing(file);
  const result = await execa(file, args, {
    cwd: options.cwd,
    stdio: "inherit",
    reject: false,
    env: { PWD: options.cwd },
  });
  const notFound = "code" in result && result.code === "ENOENT";
  return { exitCode: result.exitCode ?? -1, stdout: "", stderr: result.message ?? "", notFound };
}

function missing(file: string): CommandResult {
  return { exitCode: -1, stdout: "", stderr: `${file}: command not found`, notFound: true };
}

export type ShellResult = { exitCode: number; output: string };

export async function runShell(
  command: string,
  options: { cwd: string; timeoutMs?: number; onOutput?: (chunk: string) => void },
): Promise<ShellResult> {
  const subprocess = execa(command, {
    cwd: options.cwd,
    shell: true,
    all: true,
    reject: false,
    timeout: options.timeoutMs ?? SHELL_TIMEOUT_MS,
    env: { PWD: options.cwd },
  });
  const { onOutput } = options;
  if (onOutput) subprocess.all?.on("data", (chunk: Buffer) => onOutput(chunk.toString()));
  const result = await subprocess;
  return { exitCode: result.exitCode ?? -1, output: result.all ?? result.message ?? "" };
}
