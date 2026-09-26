import { stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { AgentName } from "../backends/agent-cli.js";
import { type Env, hasApiCredentials } from "../backends/api.js";
import type { Backend } from "../config/schema.js";

export const AGENT_BACKENDS: AgentName[] = ["claude", "opencode", "codex", "gemini"];

export async function findExecutable(
  name: string,
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const dirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  const extensions =
    platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`);
      if (await isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

export async function detectInstalledAgents(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<AgentName[]> {
  const found = await Promise.all(
    AGENT_BACKENDS.map(async (name) =>
      (await findExecutable(name, env, platform)) ? name : undefined,
    ),
  );
  return found.filter((name): name is AgentName => name !== undefined);
}

export async function suggestBackend(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<Backend> {
  const [first] = await detectInstalledAgents(env, platform);
  if (first) return first;
  return hasApiCredentials(env) ? "api" : "manual";
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
