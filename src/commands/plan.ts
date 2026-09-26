import { type Change, planChanges } from "../artifacts/merge.js";
import { applyChanges, confirmChanges } from "../artifacts/write.js";
import { fillCommands, proposeCommands } from "../config/commands.js";
import { COMMAND_KEYS, type Commands, type Config } from "../config/schema.js";
import { readConfig, writeConfig } from "../config/store.js";
import { ensureGitignore } from "../core/gitignore.js";
import { t } from "../i18n/index.js";
import { type OnlyGroup, selectFiles } from "../plan/filter.js";
import type { ParsedPlan } from "../plan/parser.js";
import { closeQuestions } from "../plan/questions.js";
import { generatePlan } from "../plan/run.js";
import { type LoadedTask, loadTaskFiles } from "../tasks/load.js";
import type { CommandContext } from "./context.js";
import { CLI, requireConfig } from "./shared.js";

export type PlanOptions = { only?: OnlyGroup };

export async function runPlan(ctx: CommandContext, options: PlanOptions): Promise<void> {
  const config = await requireConfig(ctx);
  let confirmed = false;
  while (await planOnce(ctx, config, options, confirmed)) confirmed = true;
}

async function planOnce(
  ctx: CommandContext,
  config: Config,
  options: PlanOptions,
  confirmed: boolean,
): Promise<boolean> {
  ctx.prompter.intro(t("plan.intro"));
  const existing = await loadTaskFiles(ctx.cwd);
  if (existing.length > 0 && !confirmed && !ctx.flags.dryRun && !(await regenerate(ctx))) {
    ctx.prompter.outro(t("plan.useReplan"));
    return false;
  }
  const knownTaskIds = existing.map((task) => task.id);
  const parsed = await generatePlan(ctx, config, { priorPlan: "", knownTaskIds });
  if (!parsed) {
    ctx.prompter.outro(t("plan.dryRunDone"));
    return false;
  }
  const files = selectFiles(parsed.files, { only: options.only, targets: config.targets });
  const replaced = options.only === undefined || options.only === "plan";
  const obsolete = replaced ? obsoleteTasks(existing, parsed) : [];
  const changes = [...(await planChanges(ctx.cwd, files)), ...obsolete];
  const written = await writePlanFiles(ctx, changes);
  if (written.length > 0) await saveCommands(ctx, parsed.commands);
  return reportPlan(ctx, parsed, written);
}

export function obsoleteTasks(tasks: LoadedTask[], parsed: ParsedPlan): Change[] {
  const kept = new Set(parsed.tasks.map((task) => task.meta.id));
  return tasks
    .filter((task) => task.task?.meta.status === "pending" && !kept.has(task.id))
    .map((task) => ({ path: task.path, before: task.text, after: "", kind: "delete" }));
}

export async function saveCommands(ctx: CommandContext, analyst: Commands): Promise<void> {
  const stored = await readConfig(ctx.cwd);
  if (!stored) return;
  const commands = fillCommands(stored.commands, analyst, await proposeCommands(ctx.cwd));
  const added = COMMAND_KEYS.filter((key) => commands[key] && !stored.commands[key]);
  if (added.length === 0) return;
  await writeConfig(ctx.cwd, { ...stored, commands });
  ctx.prompter.note(added.map((key) => `${key}: ${commands[key]}`).join("\n"), t("plan.commands"));
}

export async function writePlanFiles(ctx: CommandContext, changes: Change[]): Promise<Change[]> {
  const accepted = await confirmChanges(ctx, changes);
  await applyChanges(ctx.cwd, accepted);
  if (accepted.length > 0) await ensureGitignore(ctx.cwd);
  return accepted;
}

export async function reportPlan(
  ctx: CommandContext,
  parsed: ParsedPlan,
  written: Change[],
): Promise<boolean> {
  ctx.prompter.note(parsed.summary, t("plan.summary"));
  for (const warning of parsed.warnings) ctx.prompter.warn(warning);
  const closed = await closeQuestions(ctx, parsed.questions);
  const answered = closed.some((question) => question.blocking && question.answer !== "");
  if (answered && (await ctx.prompter.confirm(t("plan.rerun"), true))) {
    ctx.prompter.outro(t("plan.rerunning"));
    return true;
  }
  if (written.length === 0) {
    ctx.prompter.outro(t("plan.nothingWritten"));
    return false;
  }
  ctx.prompter.outro(t("plan.done", { count: written.length, next: `${CLI} next` }));
  return false;
}

async function regenerate(ctx: CommandContext): Promise<boolean> {
  if (ctx.flags.yes) return true;
  return ctx.prompter.confirm(t("plan.existingPlan"), false);
}
