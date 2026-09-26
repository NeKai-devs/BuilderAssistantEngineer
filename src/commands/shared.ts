import type { Config } from "../config/schema.js";
import { readConfig } from "../config/store.js";
import { UserError } from "../core/errors.js";
import { t } from "../i18n/index.js";
import { loadTaskFiles } from "../tasks/load.js";
import type { Task } from "../tasks/schema.js";
import type { CommandContext } from "./context.js";

export const CLI = "npx builder-assistant-engineer";

export async function requireConfig(ctx: CommandContext): Promise<Config> {
  const config = await readConfig(ctx.cwd);
  if (!config) throw new UserError(t("config.missing", { command: `${CLI} init` }));
  return {
    ...config,
    backend: ctx.flags.backend ?? config.backend,
    lang: ctx.flags.lang ?? config.lang,
  };
}

export function isAgentBackend(backend: Config["backend"]): boolean {
  return backend !== "api" && backend !== "manual";
}

export async function loadValidTasks(ctx: CommandContext): Promise<Task[]> {
  const loaded = await loadTaskFiles(ctx.cwd);
  for (const item of loaded) {
    if (item.error) ctx.prompter.warn(t("tasks.invalid", { error: item.error }));
  }
  return loaded.flatMap((item) => (item.task ? [item.task] : []));
}
