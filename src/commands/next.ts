import type { Config } from "../config/schema.js";
import { ExitCode } from "../core/errors.js";
import { headCommit } from "../core/git.js";
import { ensureGitignore } from "../core/gitignore.js";
import { loadPrompt, renderPrompt } from "../core/prompt-loader.js";
import { t } from "../i18n/index.js";
import { formatFindings, reviewTask } from "../review/run.js";
import { readBase, saveBase, writeRunLog } from "../tasks/runs.js";
import type { Task } from "../tasks/schema.js";
import { verificationCommands } from "../tasks/schema.js";
import { pickNext, waitingOn } from "../tasks/select.js";
import { setTaskStatus } from "../tasks/status.js";
import { findUnsafe, runVerification, type VerificationRun } from "../tasks/verify.js";
import type { CommandContext } from "./context.js";
import { CLI, isAgentBackend, loadValidTasks, requireConfig } from "./shared.js";

export type NextOptions = { headless?: boolean };

type Approval = { granted: boolean };
type Gate = { passed: boolean; retryable: boolean; report: string };

export const MAX_RETRIES = 2;
const OUTPUT_TAIL = 4_000;

export async function runNext(ctx: CommandContext, options: NextOptions): Promise<void> {
  const config = await requireConfig(ctx);
  ctx.prompter.intro(t("next.intro"));
  const tasks = await loadValidTasks(ctx);
  const task = pickNext(tasks);
  if (!task) {
    reportNoTask(ctx, tasks);
    return;
  }
  const commands = verificationCommands(task.body);
  ctx.prompter.note(describeTask(task, commands), `${task.meta.id} · ${task.meta.title}`);
  if (ctx.flags.dryRun) {
    ctx.print(`${task.text}\n`);
    ctx.prompter.outro(t("next.dryRunDone"));
    return;
  }
  const started = await start(ctx, task);
  const headless = Boolean(options.headless) && isAgentBackend(config.backend);
  if (options.headless && !headless) ctx.prompter.warn(t("next.headlessNeedsAgent"));
  const done = headless
    ? await headlessLoop(ctx, config, started, commands)
    : await attemptOnce(ctx, config, started, commands);
  if (!done) throw new ExitCode(1);
}

async function start(ctx: CommandContext, task: Task): Promise<Task> {
  await ensureGitignore(ctx.cwd);
  if (!(await readBase(ctx.cwd, task.meta.id))) {
    const head = await headCommit(ctx.cwd);
    if (head) await saveBase(ctx.cwd, task.meta.id, head);
  }
  return task.meta.status === "in_progress" ? task : setTaskStatus(ctx.cwd, task, "in_progress");
}

async function attemptOnce(
  ctx: CommandContext,
  config: Config,
  task: Task,
  commands: string[],
): Promise<boolean> {
  const backend = ctx.createBackend(isAgentBackend(config.backend) ? config.backend : "manual");
  ctx.prompter.info(t("next.launching", { backend: backend.name }));
  await backend.run(await taskPrompt(ctx, task), { cwd: ctx.cwd, interactive: true });
  await setTaskStatus(ctx.cwd, task, "in_progress");
  const gate = await runGate(ctx, config, task, commands, { granted: false });
  await writeRunLog(ctx.cwd, task.meta.id, gate.report);
  if (gate.passed) return complete(ctx, task);
  ctx.prompter.outro(t("next.notDone", { id: task.meta.id, command: `${CLI} next` }));
  return false;
}

async function headlessLoop(
  ctx: CommandContext,
  config: Config,
  task: Task,
  commands: string[],
): Promise<boolean> {
  const backend = ctx.createBackend(config.backend);
  const approval: Approval = { granted: false };
  let prompt = await taskPrompt(ctx, task);
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    ctx.prompter.info(t("next.attempt", { attempt, max: MAX_RETRIES + 1, backend: backend.name }));
    await backend.run(prompt, { cwd: ctx.cwd, access: "edit", stream: ctx.print });
    await setTaskStatus(ctx.cwd, task, "in_progress");
    const gate = await runGate(ctx, config, task, commands, approval);
    await writeRunLog(ctx.cwd, task.meta.id, `# Attempt ${attempt}\n\n${gate.report}`);
    if (gate.passed) return complete(ctx, task);
    if (!gate.retryable) {
      ctx.prompter.outro(t("next.notDone", { id: task.meta.id, command: `${CLI} next` }));
      return false;
    }
    prompt = renderPrompt(await loadPrompt("retry", ctx.cwd), {
      task: task.text,
      failure: gate.report,
      attempt: String(attempt),
    });
  }
  await setTaskStatus(ctx.cwd, task, "blocked");
  ctx.prompter.outro(t("next.blocked", { id: task.meta.id, path: `.bae/runs/${task.meta.id}/` }));
  return false;
}

async function runGate(
  ctx: CommandContext,
  config: Config,
  task: Task,
  commands: string[],
  approval: Approval,
): Promise<Gate> {
  const refused = refuse(ctx, commands);
  if (refused) return refused;
  if (!approval.granted) {
    ctx.prompter.note(commands.map((command) => `$ ${command}`).join("\n"), t("verify.commands"));
    if (!ctx.flags.yes && !(await ctx.prompter.confirm(t("verify.confirm"), true))) {
      return { passed: false, retryable: false, report: t("verify.declined") };
    }
    approval.granted = true;
  }
  const verification = await runVerification(ctx.cwd, commands, ctx.print);
  const verificationText = verificationReport(verification);
  if (!verification.passed) {
    const last = verification.runs.at(-1);
    ctx.prompter.warn(
      t("verify.failed", { command: last?.command ?? "", code: last?.exitCode ?? -1 }),
    );
    return { passed: false, retryable: true, report: verificationText };
  }
  ctx.prompter.success(t("verify.passed"));
  const review = await reviewTask(ctx, config, task);
  if (review.reason) ctx.prompter.warn(review.reason);
  const findings = formatFindings(review.findings);
  if (findings) ctx.prompter.note(findings, t("review.findings"));
  const report = `${verificationText}\n\n## Review\n\n${review.status}\n\n${findings}`.trim();
  if (review.status === "fail") return { passed: false, retryable: true, report };
  if (review.status === "pass") ctx.prompter.success(t("review.passed"));
  return { passed: true, retryable: false, report };
}

function refuse(ctx: CommandContext, commands: string[]): Gate | undefined {
  if (commands.length === 0) {
    ctx.prompter.warn(t("verify.none"));
    return { passed: false, retryable: false, report: t("verify.none") };
  }
  const unsafe = findUnsafe(commands);
  if (unsafe.length === 0) return undefined;
  const lines = unsafe.map((item) =>
    t("verify.unsafe", { command: item.command, reason: item.reason }),
  );
  for (const line of lines) ctx.prompter.warn(line);
  return { passed: false, retryable: false, report: lines.join("\n") };
}

async function complete(ctx: CommandContext, task: Task): Promise<boolean> {
  await setTaskStatus(ctx.cwd, task, "done");
  ctx.prompter.outro(t("next.done", { id: task.meta.id, command: `${CLI} next` }));
  return true;
}

function verificationReport(verification: VerificationRun): string {
  const runs = verification.runs.map(
    (run) =>
      `$ ${run.command} (exit ${run.exitCode})\n\n\`\`\`text\n${run.output.slice(-OUTPUT_TAIL).trim()}\n\`\`\``,
  );
  return ["## Verification", ...runs].join("\n\n");
}

async function taskPrompt(ctx: CommandContext, task: Task): Promise<string> {
  return renderPrompt(await loadPrompt("task", ctx.cwd), { task: task.text.trim() });
}

function describeTask(task: Task, commands: string[]): string {
  const { phase, size, risk, depends_on } = task.meta;
  const deps = depends_on.length > 0 ? depends_on.join(", ") : "-";
  const verify = commands.map((command) => `  $ ${command}`).join("\n");
  return `${t("next.meta", { phase, size, risk, deps })}\n${t("verify.commands")}:\n${verify}`;
}

function reportNoTask(ctx: CommandContext, tasks: Task[]): void {
  if (tasks.length === 0) {
    ctx.prompter.outro(t("next.noPlan", { command: `${CLI} plan` }));
    return;
  }
  if (tasks.every((task) => task.meta.status === "done")) {
    ctx.prompter.outro(t("next.allDone"));
    return;
  }
  const stuck = tasks
    .filter((task) => task.meta.status !== "done")
    .map((task) => {
      const waiting = waitingOn(task, tasks);
      const reason =
        task.meta.status === "blocked" ? "blocked" : `waiting on ${waiting.join(", ")}`;
      return `${task.meta.id} ${task.meta.title} (${reason})`;
    });
  ctx.prompter.note(stuck.join("\n"), t("next.nothingReady"));
  ctx.prompter.outro(t("next.unblock"));
}
