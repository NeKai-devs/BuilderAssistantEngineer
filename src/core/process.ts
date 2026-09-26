import { execa } from "execa";

export type CommandResult = { exitCode: number; stdout: string; stderr: string };

export type CommandOptions = { cwd: string; input?: string; timeoutMs?: number };

export async function runCommand(
  file: string,
  args: string[],
  options: CommandOptions,
): Promise<CommandResult> {
  const result = await execa(file, args, {
    cwd: options.cwd,
    input: options.input,
    timeout: options.timeoutMs,
    reject: false,
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.exitCode === undefined ? (result.message ?? "") : (result.stderr ?? ""),
  };
}
