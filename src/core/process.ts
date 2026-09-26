import { execa } from "execa";
import { findExecutable } from "./which.js";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  notFound: boolean;
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
  const subprocess = execa(file, args, {
    cwd: options.cwd,
    input: options.input,
    timeout: options.timeoutMs,
    reject: false,
  });
  const { onStdout } = options;
  if (onStdout) subprocess.stdout?.on("data", (chunk: Buffer) => onStdout(chunk.toString()));
  const result = await subprocess;
  const notFound = "code" in result && result.code === "ENOENT";
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.exitCode === undefined ? (result.message ?? "") : (result.stderr ?? ""),
    notFound,
  };
}

export async function runInteractive(
  file: string,
  args: string[],
  options: { cwd: string },
): Promise<CommandResult> {
  if (!(await findExecutable(file))) return missing(file);
  const result = await execa(file, args, { cwd: options.cwd, stdio: "inherit", reject: false });
  const notFound = "code" in result && result.code === "ENOENT";
  return { exitCode: result.exitCode ?? -1, stdout: "", stderr: result.message ?? "", notFound };
}

function missing(file: string): CommandResult {
  return { exitCode: -1, stdout: "", stderr: `${file}: command not found`, notFound: true };
}
