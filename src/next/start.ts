import type { CommandContext } from "../commands/context.js";
import { saveCommands } from "../commands/shared.js";
import type { Config } from "../config/schema.js";
import { bashPath } from "../core/bash.js";
import { ExitCode } from "../core/errors.js";
import { headCommit, isGitRepo } from "../core/git.js";
import { ensureGitignore } from "../core/gitignore.js";
import {
  type Capture,
  clearActive,
  prepareCapture,
  readActive,
  readCapture,
  saveCapture,
} from "../gates/capture.js";
import { enforceContract } from "../gates/enforce.js";
import type { Acceptance } from "../gates/findings.js";
import { type Checks, refusal } from "../gates/gate.js";
import {
  baselineFrom,
  runSuite,
  type SuiteBaseline,
  suiteCommands,
  unusableBaseline,
} from "../gates/regression.js";
import { guardState } from "../gates/state-guard.js";
import { t } from "../i18n/index.js";
import { capturedTask } from "../review/run.js";
import { recordAttempt } from "../tasks/attempts.js";
import { type Task, verificationCommands, verificationScript } from "../tasks/schema.js";
import { setTaskStatus } from "../tasks/status.js";

export type StartOptions = { allowSkip: boolean; unattended: boolean };

export function checksFor(task: Task, config: Config): Checks {
  return {
    commands: verificationCommands(task.body),
    script: verificationScript(task.body),
    suite: suiteCommands(config),
  };
}

export async function recoverInterrupted(
  ctx: CommandContext,
  acceptance: Acceptance,
): Promise<void> {
  const id = await readActive(ctx.cwd);
  if (!id) return;
  const capture = await readCapture(ctx.cwd, id);
  await clearActive(ctx.cwd);
  if (!capture) return;
  const contract = await enforceContract(ctx, capture, acceptance);
  await setTaskStatus(ctx.cwd, capturedTask(capture), "in_progress");
  if (contract.blocked) ctx.prompter.warn(t("contract.recovered", { id }));
}

export async function withSuiteCommands(ctx: CommandContext, config: Config): Promise<Config> {
  if (config.gates.regression === "off" || config.commands.test || config.commands.lint) {
    return config;
  }
  const commands = await saveCommands(ctx);
  if (!commands.test && !commands.lint) ctx.prompter.info(t("regression.noCommands"));
  return { ...config, commands };
}

export async function start(
  ctx: CommandContext,
  config: Config,
  task: Task,
  options: StartOptions,
): Promise<Capture | undefined> {
  const bash = await bashPath();
  const refused = refusal(checksFor(task, config), {
    unattended: options.unattended,
    allow: config.verify.allow,
    ...(bash ? { bash } : {}),
  });
  if (refused) {
    await blockBeforeAgent(ctx, task, refused);
    return undefined;
  }
  await ensureGitignore(ctx.cwd);
  const previous = await readCapture(ctx.cwd, task.meta.id);
  const reuse = previous && !previous.finished ? previous : undefined;
  const skips = [...(reuse?.skips ?? [])];
  const allow = (message: string) => allowOrStop(ctx, options, skips, message);
  if (!reuse && task.meta.status === "in_progress")
    allow(t("capture.lateStop", { id: task.meta.id }));
  if (!reuse && !(await isGitRepo(ctx.cwd))) allow(t("capture.noGit"));
  if (reuse?.base && reuse.base !== (await headCommit(ctx.cwd))) {
    ctx.prompter.warn(t("capture.headMoved", { id: task.meta.id }));
  }
  let baseline = reuse?.baseline;
  if (config.gates.regression === "full" && baseline === undefined) {
    if (reuse) allow(t("regression.lateStop", { id: task.meta.id }));
    baseline = await recordBaseline(ctx, config, task, options, skips);
  }
  const started = await setTaskStatus(ctx.cwd, task, "in_progress");
  const capture = await prepareCapture(ctx.cwd, config, started);
  const late = !reuse && task.meta.status === "in_progress";
  Object.assign(capture, { skips, ...(baseline ? { baseline } : {}), ...(late ? { late } : {}) });
  await saveCapture(ctx.cwd, capture);
  return capture;
}

async function recordBaseline(
  ctx: CommandContext,
  config: Config,
  task: Task,
  options: StartOptions,
  skips: string[],
): Promise<SuiteBaseline> {
  const suite = suiteCommands(config);
  if (suite.length === 0) return baselineFrom([]);
  ctx.prompter.note(
    suite.map((item) => `$ ${item.command}`).join("\n"),
    t("regression.baselineTitle"),
  );
  if (!ctx.flags.yes && !(await ctx.prompter.confirm(t("regression.confirm"), true))) {
    allowOrStop(ctx, options, skips, t("regression.declinedStop"));
    return { skipped: true, commands: {}, excluded: [] };
  }
  const guard = await guardState(ctx.cwd);
  const results = await runSuite(ctx.cwd, suite, ctx.print);
  const tampered = await guard.verify();
  if (tampered.length > 0) {
    ctx.prompter.warn(t("state.tampered", { files: tampered.join(", ") }));
    ctx.prompter.outro(t("skip.stopped"));
    throw new ExitCode(1);
  }
  for (const result of results.filter((item) => item.exitCode !== 0)) {
    ctx.prompter.warn(
      t("regression.preexisting", { command: result.command, code: result.exitCode }),
    );
  }
  const unusable = unusableBaseline(results, task.meta.tests === "fix");
  for (const result of unusable) {
    allowOrStop(
      ctx,
      options,
      skips,
      t("regression.unusable", { command: result.command, code: result.exitCode }),
    );
  }
  return baselineFrom(
    results,
    unusable.map((result) => result.command),
  );
}

function allowOrStop(
  ctx: CommandContext,
  options: StartOptions,
  skips: string[],
  message: string,
): void {
  if (!options.allowSkip) {
    ctx.prompter.warn(message);
    ctx.prompter.outro(t("skip.stopped"));
    throw new ExitCode(1);
  }
  skips.push(message);
  ctx.prompter.warn(t("skip.used", { what: message }));
}

async function blockBeforeAgent(ctx: CommandContext, task: Task, reason: string): Promise<void> {
  ctx.prompter.warn(reason);
  await setTaskStatus(ctx.cwd, task, "blocked");
  await recordAttempt(ctx.cwd, task.meta.id, {
    startedAt: new Date().toISOString(),
    durationMs: 0,
    headless: false,
    outcome: "blocked",
    stage: "refused",
    regressions: [],
    reason,
  });
  ctx.prompter.outro(t("next.refusedBlocked", { id: task.meta.id }));
}
