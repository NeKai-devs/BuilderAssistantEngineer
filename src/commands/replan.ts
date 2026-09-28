import { planChanges } from "../artifacts/merge.js";
import type { Config } from "../config/schema.js";
import { t } from "../i18n/index.js";
import { selectFiles } from "../plan/filter.js";
import { buildPriorPlan } from "../plan/prior.js";
import { generatePlan } from "../plan/run.js";
import { loadTaskFiles } from "../tasks/load.js";
import type { CommandContext } from "./context.js";
import { obsoleteTasks, reportPlan, writePlanFiles } from "./plan.js";
import { CLI, requireConfig, saveCommands } from "./shared.js";

const CHANGELOG = "docs/plan/CHANGELOG.md";

export async function runReplan(ctx: CommandContext): Promise<void> {
  const config = await requireConfig(ctx);
  while (await replanOnce(ctx, config)) {}
}

async function replanOnce(ctx: CommandContext, config: Config): Promise<boolean> {
  ctx.prompter.intro(t("replan.intro"));
  const tasks = await loadTaskFiles(ctx.cwd);
  if (tasks.length === 0) {
    ctx.prompter.outro(t("replan.noPlan", { command: `${CLI} plan` }));
    return false;
  }
  const priorPlan = await buildPriorPlan(ctx.cwd, tasks);
  const parsed = await generatePlan(ctx, config, {
    priorPlan,
    knownTaskIds: tasks.map((task) => task.id),
  });
  if (!parsed) {
    ctx.prompter.outro(t("plan.dryRunDone"));
    return false;
  }
  if (!parsed.files.some((file) => file.path === CHANGELOG))
    ctx.prompter.warn(t("replan.noChangelog"));
  const files = selectFiles(parsed.files, { targets: config.targets });
  const changes = [...(await planChanges(ctx.cwd, files)), ...obsoleteTasks(tasks, parsed)];
  const written = await writePlanFiles(ctx, changes);
  await saveCommands(ctx, parsed.commands);
  return reportPlan(ctx, parsed, written);
}
