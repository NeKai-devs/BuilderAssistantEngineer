import type { AgentName } from "../backends/agent-cli.js";
import { type Env, hasApiCredentials } from "../backends/api.js";
import type { Backend } from "../config/schema.js";
import { findExecutable } from "../core/which.js";

export { findExecutable };

export const AGENT_BACKENDS: AgentName[] = ["claude", "opencode", "codex", "gemini"];

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
  return pickDefaultBackend(await detectInstalledAgents(env, platform), env);
}

export function pickDefaultBackend(installed: AgentName[], env: Env): Backend {
  const [first] = installed;
  if (first) return first;
  return hasApiCredentials(env) ? "api" : "manual";
}
