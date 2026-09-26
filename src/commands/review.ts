import { ExitCode, UserError } from "../core/errors.js";
import { t } from "../i18n/index.js";
import { formatFindings, reviewTask } from "../review/run.js";
import type { CommandContext } from "./context.js";
import { loadValidTasks, requireConfig } from "./shared.js";

export async function runReview(ctx: CommandContext, taskId: string | undefined): Promise<void> {
  const config = await requireConfig(ctx);
  ctx.prompter.intro(t("review.intro"));
  const tasks = await loadValidTasks(ctx);
  const wanted = taskId?.toUpperCase();
  const task = wanted
    ? tasks.find((candidate) => candidate.meta.id === wanted)
    : tasks.find((candidate) => candidate.meta.status === "in_progress");
  if (!task) {
    throw new UserError(wanted ? t("review.unknownTask", { id: wanted }) : t("review.noTask"));
  }
  const result = await reviewTask(ctx, config, task);
  if (result.findings.length > 0)
    ctx.prompter.note(formatFindings(result.findings), t("review.findings"));
  if (result.status === "skipped") {
    ctx.prompter.outro(result.reason ?? "");
    return;
  }
  if (result.status === "pass") {
    ctx.prompter.outro(t("review.passed"));
    return;
  }
  ctx.prompter.outro(t("review.failed", { id: task.meta.id }));
  throw new ExitCode(1);
}
