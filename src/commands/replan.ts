import type { Change } from "../artifacts/merge.js";
import { planChanges } from "../artifacts/merge.js";
import { t } from "../i18n/index.js";
import { selectFiles } from "../plan/filter.js";
import type { ParsedPlan } from "../plan/parser.js";
import { buildPriorPlan } from "../plan/prior.js";
import { generatePlan } from "../plan/run.js";
import { type LoadedTask, loadTaskFiles } from "../tasks/load.js";
import type { CommandContext } from "./context.js";
import { reportPlan, saveCommands, writePlanFiles } from "./plan.js";
import { CLI, requireConfig } from "./shared.js";

const CHANGELOG = "docs/plan/CHANGELOG.md";

export async function runReplan(ctx: CommandContext): Promise<void> {
  const config = await requireConfig(ctx);
  ctx.prompter.intro(t("replan.intro"));
  const tasks = await loadTaskFiles(ctx.cwd);
  if (tasks.length === 0) {
    ctx.prompter.outro(t("replan.noPlan", { command: `${CLI} plan` }));
    return;
  }
  const priorPlan = await buildPriorPlan(ctx.cwd, tasks);
  const parsed = await generatePlan(ctx, config, {
    priorPlan,
    knownTaskIds: tasks.map((task) => task.id),
  });
  if (!parsed) {
    ctx.prompter.outro(t("plan.dryRunDone"));
    return;
  }
  if (!parsed.files.some((file) => file.path === CHANGELOG))
    ctx.prompter.warn(t("replan.noChangelog"));
  const files = selectFiles(parsed.files, { targets: config.targets });
  const changes = [...(await planChanges(ctx.cwd, files)), ...obsoleteTasks(tasks, parsed)];
  const written = await writePlanFiles(ctx, changes);
  if (written.length > 0) await saveCommands(ctx, parsed.commands);
  reportPlan(ctx, parsed, written);
}

function obsoleteTasks(tasks: LoadedTask[], parsed: ParsedPlan): Change[] {
  const kept = new Set(parsed.tasks.map((task) => task.meta.id));
  return tasks
    .filter((task) => task.task?.meta.status === "pending" && !kept.has(task.id))
    .map((task) => ({ path: task.path, before: task.text, after: "", kind: "delete" }));
}
