import { withGeneratedFiles } from "../artifacts/generated.js";
import { type Change, planChanges } from "../artifacts/merge.js";
import { applyChanges, confirmChanges } from "../artifacts/write.js";
import type { Config } from "../config/schema.js";
import { isGitRepo } from "../core/git.js";
import { ensureGitignore } from "../core/gitignore.js";
import { t } from "../i18n/index.js";
import { currentBranch } from "../next/branch.js";
import { type CommitOptions, commitPaths } from "../next/commit.js";
import { type OnlyGroup, selectFiles } from "../plan/filter.js";
import type { ParsedPlan } from "../plan/parser.js";
import { closeQuestions } from "../plan/questions.js";
import { generatePlan } from "../plan/run.js";
import { type LoadedTask, loadTaskFiles } from "../tasks/load.js";
import type { CommandContext } from "./context.js";
import { CLI, requireConfig, saveCommands } from "./shared.js";

export type PlanOptions = { only?: OnlyGroup; verify?: boolean };

const PLAN_MESSAGE = ["chore(bae): plan"];
const PLAN_INPUTS = [".bae/config.json", ".bae/interview.md", ".gitignore"];

export async function runPlan(ctx: CommandContext, options: PlanOptions): Promise<void> {
  const config = await requireConfig(ctx);
  const written = new Set<string>();
  let confirmed = false;
  while (await planOnce(ctx, config, options, confirmed, written)) confirmed = true;
}

async function planOnce(
  ctx: CommandContext,
  config: Config,
  options: PlanOptions,
  confirmed: boolean,
  written: Set<string>,
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
  const files = selectFiles(withGeneratedFiles(parsed.files), {
    only: options.only,
    targets: config.targets,
  });
  const replaced = options.only === undefined || options.only === "plan";
  const obsolete = replaced ? obsoleteTasks(existing, parsed) : [];
  const changes = [...(await planChanges(ctx.cwd, files)), ...obsolete];
  const accepted = await writePlanFiles(ctx, changes);
  for (const change of accepted) written.add(change.path);
  await saveCommands(ctx, parsed.commands);
  return reportPlan(ctx, parsed, accepted, () =>
    offerCommit(ctx, [...written], { verify: options.verify !== false }),
  );
}

async function offerCommit(
  ctx: CommandContext,
  paths: string[],
  options: CommitOptions,
): Promise<void> {
  if (paths.length === 0 || !(await isGitRepo(ctx.cwd))) return;
  if (!ctx.flags.yes && !(await ctx.prompter.confirm(t("plan.commitConfirm"), true))) return;
  const result = await commitPaths(ctx.cwd, [...paths, ...PLAN_INPUTS], PLAN_MESSAGE, options);
  if (!result.ok) {
    ctx.prompter.warn(t("commit.planFailed", { details: result.details }));
    return;
  }
  const branch = (await currentBranch(ctx.cwd)) ?? "HEAD";
  ctx.prompter.info(t("commit.plan", { sha: result.sha, branch }));
}

export function obsoleteTasks(tasks: LoadedTask[], parsed: ParsedPlan): Change[] {
  const kept = new Set(parsed.tasks.map((task) => task.meta.id));
  return tasks
    .filter((task) => isReplaceable(task.task?.meta.status) && !kept.has(task.id))
    .map((task) => ({ path: task.path, before: task.text, after: "", kind: "delete" }));
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
  commit?: () => Promise<void>,
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
  await commit?.();
  ctx.prompter.outro(t("plan.done", { count: written.length, next: `${CLI} next` }));
  return false;
}

async function regenerate(ctx: CommandContext): Promise<boolean> {
  if (ctx.flags.yes) return true;
  return ctx.prompter.confirm(t("plan.existingPlan"), false);
}

function isReplaceable(status: string | undefined): boolean {
  return status === "pending" || status === "needs_review";
}
