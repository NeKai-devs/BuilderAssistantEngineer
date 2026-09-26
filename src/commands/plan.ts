import { type Change, planChanges } from "../artifacts/merge.js";
import { applyChanges, confirmChanges } from "../artifacts/write.js";
import { ensureGitignore } from "../core/gitignore.js";
import { t } from "../i18n/index.js";
import { type OnlyGroup, selectFiles } from "../plan/filter.js";
import type { ParsedPlan } from "../plan/parser.js";
import { formatQuestions, generatePlan } from "../plan/run.js";
import { loadTaskFiles } from "../tasks/load.js";
import type { CommandContext } from "./context.js";
import { CLI, requireConfig } from "./shared.js";

export type PlanOptions = { only?: OnlyGroup };

export async function runPlan(ctx: CommandContext, options: PlanOptions): Promise<void> {
  const config = await requireConfig(ctx);
  ctx.prompter.intro(t("plan.intro"));
  const existing = await loadTaskFiles(ctx.cwd);
  if (existing.length > 0 && !ctx.flags.dryRun && !(await regenerate(ctx))) {
    ctx.prompter.outro(t("plan.useReplan"));
    return;
  }
  const knownTaskIds = existing.map((task) => task.id);
  const parsed = await generatePlan(ctx, config, { priorPlan: "", knownTaskIds });
  if (!parsed) {
    ctx.prompter.outro(t("plan.dryRunDone"));
    return;
  }
  const files = selectFiles(parsed.files, { only: options.only, targets: config.targets });
  const written = await writePlanFiles(ctx, await planChanges(ctx.cwd, files));
  reportPlan(ctx, parsed, written);
}

export async function writePlanFiles(ctx: CommandContext, changes: Change[]): Promise<Change[]> {
  const accepted = await confirmChanges(ctx, changes);
  await applyChanges(ctx.cwd, accepted);
  if (accepted.length > 0) await ensureGitignore(ctx.cwd);
  return accepted;
}

export function reportPlan(ctx: CommandContext, parsed: ParsedPlan, written: Change[]): void {
  ctx.prompter.note(parsed.summary, t("plan.summary"));
  for (const warning of parsed.warnings) ctx.prompter.warn(warning);
  if (parsed.questions.length > 0) {
    ctx.prompter.note(formatQuestions(parsed.questions), t("plan.questions"));
  }
  if (written.length === 0) {
    ctx.prompter.outro(t("plan.nothingWritten"));
    return;
  }
  ctx.prompter.outro(t("plan.done", { count: written.length, next: `${CLI} next` }));
}

async function regenerate(ctx: CommandContext): Promise<boolean> {
  if (ctx.flags.yes) return true;
  return ctx.prompter.confirm(t("plan.existingPlan"), false);
}
