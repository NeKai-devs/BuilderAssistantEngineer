import { ExitCode, UserError } from "../core/errors.js";
import { prepareCapture, readCapture } from "../gates/capture.js";
import { newAcceptance } from "../gates/findings.js";
import { t } from "../i18n/index.js";
import { formatFindings, reviewTask } from "../review/run.js";
import type { CommandContext } from "./context.js";
import { loadValidTasks, requireConfig } from "./shared.js";

export type ReviewOptions = { acceptFinding?: string[] };

export async function runReview(
  ctx: CommandContext,
  taskId: string | undefined,
  options: ReviewOptions = {},
): Promise<void> {
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
  const stored = await readCapture(ctx.cwd, task.meta.id);
  if (!stored) ctx.prompter.warn(t("review.noCapture", { id: task.meta.id }));
  const capture = stored ?? { ...(await prepareCapture(ctx.cwd, config, task)), snapshot: {} };
  const result = await reviewTask(ctx, capture, [], newAcceptance(options.acceptFinding));
  if (result.reason && result.status === "fail") ctx.prompter.warn(result.reason);
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
