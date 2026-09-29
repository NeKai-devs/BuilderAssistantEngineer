import { fillCommands, proposeCommands } from "../config/commands.js";
import { COMMAND_KEYS, type Commands, type Config } from "../config/schema.js";
import { readConfig, writeConfig } from "../config/store.js";
import { UserError } from "../core/errors.js";
import { ensureGitignore } from "../core/gitignore.js";
import { t } from "../i18n/index.js";
import { loadTaskFiles } from "../tasks/load.js";
import type { Task } from "../tasks/schema.js";
import type { CommandContext } from "./context.js";

export const CLI = invokedAs(process.argv[1]);

export function invokedAs(script: string | undefined): string {
  const name = (script ?? "")
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.(c?js|mjs|cmd|ps1|exe)$/i, "");
  return name === "bae" ? "bae" : "npx builder-assistant-engineer";
}

export async function requireConfig(ctx: CommandContext): Promise<Config> {
  const config = await readConfig(ctx.cwd);
  if (!config) throw new UserError(t("config.missing", { command: `${CLI} init` }));
  if (!ctx.flags.dryRun) await ensureGitignore(ctx.cwd);
  return {
    ...config,
    backend: ctx.flags.backend ?? config.backend,
    lang: ctx.flags.lang ?? config.lang,
  };
}

export async function saveCommands(ctx: CommandContext, analyst: Commands = {}): Promise<Commands> {
  const stored = await readConfig(ctx.cwd);
  if (!stored) return analyst;
  const commands = fillCommands(stored.commands, analyst, await proposeCommands(ctx.cwd));
  const added = COMMAND_KEYS.filter((key) => commands[key] && !stored.commands[key]);
  if (added.length === 0 || ctx.flags.dryRun) return commands;
  await writeConfig(ctx.cwd, { ...stored, commands });
  ctx.prompter.note(added.map((key) => `${key}: ${commands[key]}`).join("\n"), t("plan.commands"));
  return commands;
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
