import { type Change, planChanges } from "../artifacts/merge.js";
import type { Config } from "../config/schema.js";
import { t } from "../i18n/index.js";
import { type Run, requireRunBranch } from "../next/branch.js";
import { type CommitOptions, commitPaths } from "../next/commit.js";
import { selectFiles } from "../plan/filter.js";
import { buildPriorPlan } from "../plan/prior.js";
import { generatePlan } from "../plan/run.js";
import { loadTaskFiles } from "../tasks/load.js";
import type { CommandContext } from "./context.js";
import { obsoleteTasks, reportPlan, writePlanFiles } from "./plan.js";
import { CLI, requireConfig, saveCommands } from "./shared.js";

const CHANGELOG = "docs/plan/CHANGELOG.md";
const CONFIG_PATH = ".bae/config.json";
const REPLAN_MESSAGE = ["chore(bae): replan"];

export type ReplanOptions = { verify?: boolean };

export async function runReplan(ctx: CommandContext, options: ReplanOptions = {}): Promise<void> {
  const config = await requireConfig(ctx);
  const commit: CommitOptions = { verify: options.verify !== false };
  while (await replanOnce(ctx, config, commit)) {}
}

async function replanOnce(
  ctx: CommandContext,
  config: Config,
  commit: CommitOptions,
): Promise<boolean> {
  ctx.prompter.intro(t("replan.intro"));
  const run = await requireRunBranch(ctx);
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
  if (run && written.length > 0) await commitPlan(ctx, run, written, commit);
  return reportPlan(ctx, parsed, written);
}

async function commitPlan(
  ctx: CommandContext,
  run: Run,
  written: Change[],
  options: CommitOptions,
): Promise<void> {
  const paths = [...written.map((change) => change.path), CONFIG_PATH];
  const result = await commitPaths(ctx.cwd, paths, REPLAN_MESSAGE, options);
  if (result.ok) ctx.prompter.info(t("commit.replan", { sha: result.sha, branch: run.branch }));
  else ctx.prompter.warn(t("commit.planFailed", { details: result.details }));
}
