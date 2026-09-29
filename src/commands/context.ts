import type { Env } from "../backends/api.js";
import { createBackend } from "../backends/index.js";
import type { Backend } from "../backends/types.js";
import type { Backend as BackendName } from "../config/schema.js";
import type { GlobalFlags } from "../config/settings.js";
import type { Usage } from "../core/usage.js";
import { createClackPrompter } from "../ui/clack.js";
import type { Prompter } from "../ui/prompter.js";

export type CommandDeps = {
  prompter: Prompter;
  createBackend: (name: BackendName) => Backend;
  env: Env;
  print: (text: string) => void;
  usage?: Usage;
};

export type CommandContext = CommandDeps & { cwd: string; flags: GlobalFlags };

export function defaultDeps(): CommandDeps {
  return {
    prompter: createClackPrompter(),
    createBackend: (name) => createBackend(name),
    env: process.env,
    print: (text) => {
      process.stdout.write(text);
    },
  };
}
