import type { Backend as BackendName } from "../config/schema.js";
import { AGENT_SPECS, createAgentBackend, defaultRunner, type ProcessRunner } from "./agent-cli.js";
import { type ApiDeps, createApiBackend } from "./api.js";
import { createManualBackend, type ManualIo } from "./manual.js";
import type { Backend } from "./types.js";

export type { Access, Backend, RunInfo, RunOptions } from "./types.js";

export type BackendDeps = {
  runner: ProcessRunner;
  api: Partial<ApiDeps>;
  manual: Partial<ManualIo>;
};

export function createBackend(name: BackendName, deps: Partial<BackendDeps> = {}): Backend {
  if (name === "api") return createApiBackend(deps.api);
  if (name === "manual") return createManualBackend(deps.manual);
  return createAgentBackend(AGENT_SPECS[name], deps.runner ?? defaultRunner);
}
