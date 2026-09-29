import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { superviseGroup } from "./group.js";
import type { ShellResult } from "./process.js";
import { dropScratch, scratchDir } from "./scratch.js";
import { type Env, findExecutable } from "./which.js";

const SCRIPT_TIMEOUT_MS = 15 * 60_000;
const WSL_BASH = /[\\/](system32|sysnative|windowsapps)[\\/]/i;

let cached: Promise<string | undefined> | undefined;

export function bashPath(): Promise<string | undefined> {
  cached ??= findBash();
  return cached;
}

export async function findBash(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (platform !== "win32") return findExecutable("bash", env, platform);
  const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432].filter(Boolean);
  const candidates = [
    ...roots.map((root) => join(root ?? "", "Git", "bin", "bash.exe")),
    ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe")] : []),
  ];
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }
  const found = await findExecutable("bash", env, platform);
  return found && !WSL_BASH.test(found) ? found : undefined;
}

export type ScriptOptions = {
  cwd: string;
  onOutput?: (chunk: string) => void;
  timeoutMs?: number;
  env?: Record<string, string>;
};

export async function runScript(
  bash: string,
  script: string,
  options: ScriptOptions,
): Promise<ShellResult & { stdout: string }> {
  const dir = await scratchDir("bae-script-");
  const file = join(dir, "script.sh");
  await writeFile(file, script, "utf8");
  const group = process.platform !== "win32";
  const limit = options.timeoutMs ?? SCRIPT_TIMEOUT_MS;
  try {
    const subprocess = execa(bash, ["--noprofile", "--norc", file], {
      cwd: options.cwd,
      all: true,
      reject: false,
      detached: group,
      ...(group ? {} : { timeout: limit }),
      env: { ...options.env, PWD: options.cwd },
    });
    const { onOutput } = options;
    if (onOutput) subprocess.all?.on("data", (chunk: Buffer) => onOutput(chunk.toString()));
    const supervised = superviseGroup(subprocess, limit, group);
    const result = await subprocess.finally(supervised.release);
    if (supervised.timedOut()) {
      return {
        exitCode: -1,
        output: result.all ?? "",
        stdout: typeof result.stdout === "string" ? result.stdout : "",
      };
    }
    return {
      exitCode: result.exitCode ?? -1,
      output: result.all ?? result.message ?? "",
      stdout: typeof result.stdout === "string" ? result.stdout : "",
    };
  } finally {
    await dropScratch(dir);
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
