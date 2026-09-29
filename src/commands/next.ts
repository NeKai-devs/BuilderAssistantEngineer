import { join } from "node:path";
import { AGENT_SPECS, type AgentName } from "../backends/agent-cli.js";
import type { Config } from "../config/schema.js";
import { ExitCode } from "../core/errors.js";
import { readTextIfExists } from "../core/fs.js";
import { git, gitPaths, headCommit, isGitRepo } from "../core/git.js";
import { userChanges } from "../core/gitignore.js";
import { loadPrompt, renderPrompt } from "../core/prompt-loader.js";
import { type Capture, readCapture } from "../gates/capture.js";
import { newAcceptance } from "../gates/findings.js";
import type { Checks, GateRun } from "../gates/gate.js";
import { suiteCommands } from "../gates/regression.js";
import { t } from "../i18n/index.js";
import { attemptOnce, headlessLoop, permissionNote } from "../next/attempts.js";
import { useRunBranch } from "../next/branch.js";
import { checksFor, recoverInterrupted, start, withSuiteCommands } from "../next/start.js";
import { requireTrust } from "../next/trust.js";
import { capturedTask } from "../review/run.js";
import { MAX_ATTEMPTS, readAttempts, sinceBlocked } from "../tasks/attempts.js";
import { MAX_LOG_LINES, planContext } from "../tasks/handoff.js";
import { completionTimes, readMetrics } from "../tasks/metrics.js";
import type { Task } from "../tasks/schema.js";
import { pickNext, waitingOn } from "../tasks/select.js";
import type { CommandContext } from "./context.js";
import { CLI, isAgentBackend, loadValidTasks, requireConfig } from "./shared.js";

export type NextOptions = {
  headless?: boolean;
  allowDirty?: boolean;
  acceptFinding?: string[];
  allowSkip?: boolean;
  newRun?: boolean;
  verify?: boolean;
};

export async function runNext(ctx: CommandContext, options: NextOptions): Promise<void> {
  const acceptance = newAcceptance(options.acceptFinding);
  await recoverInterrupted(ctx, acceptance);
  const stored = await requireConfig(ctx);
  ctx.prompter.intro(t("next.intro"));
  const tasks = await loadValidTasks(ctx);
  const task = pickNext(tasks, await exhaustedTasks(ctx, tasks));
  if (!task) {
    reportNoTask(ctx, tasks);
    return;
  }
  const config = task.meta.status === "pending" ? await withSuiteCommands(ctx, stored) : stored;
  ctx.prompter.note(
    describeTask(task, checksFor(task, config)),
    `${task.meta.id} · ${task.meta.title}`,
  );
  if (ctx.flags.dryRun) {
    ctx.print(`${task.text}\n`);
    ctx.prompter.outro(t("next.dryRunDone"));
    return;
  }
  const allowSkip = Boolean(options.allowSkip);
  const headless = Boolean(options.headless) && isAgentBackend(config.backend);
  const unattended = headless || Boolean(ctx.flags.yes);
  if ((await isGitRepo(ctx.cwd)) && !(await headCommit(ctx.cwd))) {
    ctx.prompter.warn(t("next.noCommits"));
    ctx.prompter.outro(t("next.nothingRun", { command: `${CLI} next` }));
    throw new ExitCode(1);
  }
  await preflight(ctx, config.backend);
  await requireTrust(ctx, config, tasks);
  const previous = await readCapture(ctx.cwd, task.meta.id);
  const resumed = previous !== undefined && !previous.finished;
  if (task.meta.status === "pending" && !resumed) {
    await checkClean(ctx, unattended, options.allowDirty);
    await warnUncommittedPlan(ctx);
  }
  const enter = () => useRunBranch(ctx, Boolean(options.newRun));
  const capture = await start(ctx, config, task, { allowSkip, unattended, enter });
  if (!capture) throw new ExitCode(1);
  const run: GateRun = {
    capture,
    checks: checksFor(capturedTask(capture), capture.config),
    approval: { granted: false },
    acceptance,
    allowSkip,
    unattended,
    verify: options.verify !== false,
    tampered: [],
  };
  const prompt = await taskPrompt(ctx, capture, tasks, headless);
  if (options.headless && !headless) ctx.prompter.warn(t("next.headlessNeedsAgent"));
  const done = headless
    ? await headlessLoop(ctx, run, prompt)
    : await attemptOnce(ctx, run, prompt);
  if (!done) throw new ExitCode(1);
}

const OWN_PATHS = [".bae/", "docs/plan/tasks/"];

async function checkClean(
  ctx: CommandContext,
  unattended: boolean,
  allowed = false,
): Promise<void> {
  const status = (await git(ctx.cwd, ["status", "--porcelain", "--untracked-files=no"])) ?? "";
  const others = await userChanges(ctx.cwd, status, OWN_PATHS);
  if (others.length === 0 || allowed) return;
  ctx.prompter.note(others.map((path) => `  ${path}`).join("\n"), t("next.dirtyTitle"));
  if (!unattended && (await ctx.prompter.confirm(t("next.dirtyConfirm"), false))) return;
  ctx.prompter.outro(t("next.dirtyStop", { command: `${CLI} next` }));
  throw new ExitCode(1);
}

const PLAN_PATHS = ["docs/plan", "AGENTS.md", "CLAUDE.md", "GEMINI.md", ".bae/config.json"];

async function warnUncommittedPlan(ctx: CommandContext): Promise<void> {
  const loose = await gitPaths(ctx.cwd, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...PLAN_PATHS,
  ]);
  if (loose && loose.length > 0) {
    ctx.prompter.warn(t("next.planUncommitted", { count: loose.length }));
  }
}

async function preflight(ctx: CommandContext, name: Config["backend"]): Promise<void> {
  if (!isAgentBackend(name)) return;
  const backend = ctx.createBackend(name);
  if ((await backend.available?.()) !== false) return;
  const command = AGENT_SPECS[name as AgentName]?.command ?? name;
  ctx.prompter.warn(t("backend.notInstalled", { command }));
  ctx.prompter.outro(t("next.nothingRun", { command: `${CLI} next` }));
  throw new ExitCode(1);
}

async function exhaustedTasks(ctx: CommandContext, tasks: Task[]): Promise<Set<string>> {
  const inProgress = tasks.filter((task) => task.meta.status === "in_progress");
  const used = await Promise.all(
    inProgress.map(
      async (task) =>
        [task.meta.id, sinceBlocked(await readAttempts(ctx.cwd, task.meta.id)).length] as const,
    ),
  );
  return new Set(used.filter(([, count]) => count >= MAX_ATTEMPTS).map(([id]) => id));
}

async function taskPrompt(
  ctx: CommandContext,
  capture: Capture,
  tasks: Task[],
  headless: boolean,
): Promise<string> {
  const task = capturedTask(capture);
  const others = tasks.map((item) => (item.meta.id === task.meta.id ? task : item));
  const metrics = await readMetrics(
    ctx.cwd,
    others.filter((item) => item.meta.status === "done").map((item) => item.meta.id),
  );
  return renderPrompt(await loadPrompt("task", ctx.cwd), {
    context: planContext(capture.config, others, task, completionTimes(metrics)),
    task: task.text.trim(),
    task_path: task.path,
    max_log_lines: String(MAX_LOG_LINES),
    suite:
      suiteCommands(capture.config).length > 0
        ? ", then the project's lint and test commands, which must not turn red"
        : "",
    permissions: headless ? permissionNote(capture) : "",
  });
}

function describeTask(task: Task, checks: Checks): string {
  const { phase, size, risk, depends_on } = task.meta;
  const deps = depends_on.length > 0 ? depends_on.join(", ") : "-";
  const verify = checks.commands.map((command) => `  $ ${command}`).join("\n");
  const lines = [t("next.meta", { phase, size, risk, deps }), `${t("verify.commands")}:`, verify];
  if (checks.suite.length > 0) {
    lines.push(`${t("regression.title")}:`, ...checks.suite.map((item) => `  $ ${item.command}`));
  }
  return lines.join("\n");
}

function reportNoTask(ctx: CommandContext, tasks: Task[]): void {
  if (tasks.length === 0) {
    ctx.prompter.outro(t("next.noPlan", { command: `${CLI} plan` }));
    throw new ExitCode(1);
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
        task.meta.status === "blocked"
          ? "blocked"
          : task.meta.status === "needs_review"
            ? t("next.needsReview", { note: task.meta.review_note ?? "" })
            : `waiting on ${waiting.join(", ")}`;
      return `${task.meta.id} ${task.meta.title} (${reason})`;
    });
  ctx.prompter.note(stuck.join("\n"), t("next.nothingReady"));
  ctx.prompter.outro(t("next.unblock"));
  throw new ExitCode(1);
}
