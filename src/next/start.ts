import type { CommandContext } from "../commands/context.js";
import { saveCommands } from "../commands/shared.js";
import type { Config } from "../config/schema.js";
import { bashPath } from "../core/bash.js";
import { ExitCode } from "../core/errors.js";
import { gitPaths, headCommit, isGitRepo } from "../core/git.js";
import { ensureGitignore } from "../core/gitignore.js";
import { isTestFile } from "../digest/baseline.js";
import {
  type Capture,
  clearActive,
  prepareCapture,
  readActive,
  readCapture,
  saveCapture,
} from "../gates/capture.js";
import { checkContract, collectProtected, restoreContract } from "../gates/contract.js";
import { enforceContract } from "../gates/enforce.js";
import type { Acceptance } from "../gates/findings.js";
import { type Checks, refusal } from "../gates/gate.js";
import { captureIgnore } from "../gates/ignore-rules.js";
import {
  baselineFrom,
  runSuite,
  type SuiteBaseline,
  type SuiteResult,
  suiteCommands,
  unusableBaseline,
} from "../gates/regression.js";
import { readSources, testRunners } from "../gates/runners.js";
import { guardState } from "../gates/state-guard.js";
import { t } from "../i18n/index.js";
import { capturedTask } from "../review/run.js";
import { scopePaths } from "../review/scope.js";
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
  if (!capture) {
    await clearActive(ctx.cwd);
    return;
  }
  const contract = await enforceContract(ctx, capture, acceptance);
  await setTaskStatus(ctx.cwd, capturedTask(capture), "in_progress");
  await clearActive(ctx.cwd);
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
  const excluded = new Set(reuse?.baseline?.excluded ?? []);
  const fresh = !(await hasTestFiles(ctx.cwd));
  const unrecognized = fresh
    ? []
    : (await unrecognizedTests(ctx.cwd, config)).filter((command) => !excluded.has(command));
  for (const command of unrecognized) allow(t("regression.unknownRunner", { command }));
  let baseline = reuse?.baseline;
  if (config.gates.regression === "full" && baseline === undefined) {
    if (reuse) allow(t("regression.lateStop", { id: task.meta.id }));
    baseline = await recordBaseline(ctx, config, task, { ...options, unrecognized, fresh }, skips);
  }
  const started = await setTaskStatus(ctx.cwd, task, "in_progress");
  const capture = await prepareCapture(ctx.cwd, config, started);
  const late = !reuse && task.meta.status === "in_progress";
  Object.assign(capture, { skips, ...(baseline ? { baseline } : {}), ...(late ? { late } : {}) });
  await saveCapture(ctx.cwd, capture);
  return capture;
}

async function unrecognizedTests(cwd: string, config: Config): Promise<string[]> {
  const sources = await readSources(cwd);
  return suiteCommands(config)
    .filter((item) => item.key === "test" && testRunners(item.command, sources).length === 0)
    .map((item) => item.command);
}

async function recordBaseline(
  ctx: CommandContext,
  config: Config,
  task: Task,
  options: StartOptions & { unrecognized: string[]; fresh: boolean },
  skips: string[],
): Promise<SuiteBaseline> {
  const suite = suiteCommands(config).filter(
    (item) => !options.unrecognized.includes(item.command),
  );
  if (suite.length === 0) return baselineFrom([], options.unrecognized);
  ctx.prompter.note(
    suite.map((item) => `$ ${item.command}`).join("\n"),
    t("regression.baselineTitle"),
  );
  if (!ctx.flags.yes && !(await ctx.prompter.confirm(t("regression.confirm"), true))) {
    allowOrStop(ctx, options, skips, t("regression.declinedStop"));
    return { skipped: true, commands: {}, excluded: [] };
  }
  const guard = await guardState(ctx.cwd);
  const before = await collectProtected(ctx.cwd, {
    suite: suite.map((item) => item.command),
    verification: verificationCommands(task.body),
    own: scopePaths(task),
  });
  const results = await runSuite(ctx.cwd, suite, ctx.print, config.gates.timeoutMinutes * 60_000);
  const tampered = await guard.verify();
  const changed = await checkContract(ctx.cwd, {
    ...before,
    ignore: await captureIgnore(ctx.cwd),
    taskPath: task.path,
  });
  if (tampered.length > 0 || changed.length > 0) {
    await restoreContract(ctx.cwd, changed);
    const files = [...tampered, ...changed.map((change) => change.path)].join(", ");
    ctx.prompter.warn(t("regression.baselineTampered", { files }));
    ctx.prompter.outro(t("skip.stopped"));
    throw new ExitCode(1);
  }
  for (const result of results.filter((item) => item.exitCode !== 0)) {
    ctx.prompter.warn(
      t("regression.preexisting", { command: result.command, code: result.exitCode }),
    );
  }
  const found = unusableBaseline(results, task.meta.tests === "fix");
  const absent = options.fresh
    ? found.filter((result) => result.key === "test" && result.exitCode !== -1)
    : [];
  const unusable = found.filter((result) => !absent.includes(result));
  for (const result of absent) {
    ctx.prompter.info(t("regression.noTestsYet", { command: result.command }));
  }
  for (const result of unusable) allowOrStop(ctx, options, skips, unusableMessage(result));
  return baselineFrom(
    results,
    [...options.unrecognized, ...unusable.map((result) => result.command)],
    absent.map((result) => result.command),
  );
}

async function hasTestFiles(cwd: string): Promise<boolean> {
  const files =
    (await gitPaths(cwd, ["ls-files", "--cached", "--others", "--exclude-standard"])) ?? [];
  return files.some((path) => isTestFile(path));
}

function unusableMessage(result: SuiteResult): string {
  const vars = { command: result.command, code: result.exitCode };
  if (result.unrecognized) return t("regression.unknownRunner", vars);
  if (result.key === "test" && result.exitCode === 0) return t("regression.noCounts", vars);
  return t("regression.unusable", vars);
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
