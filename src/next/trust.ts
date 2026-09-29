import { createHash } from "node:crypto";
import { join } from "node:path";
import type { CommandContext } from "../commands/context.js";
import { CLI } from "../commands/shared.js";
import type { Config } from "../config/schema.js";
import { ExitCode } from "../core/errors.js";
import { readTextIfExists } from "../core/fs.js";
import { repoState, writeState } from "../core/state.js";
import { suiteCommands } from "../gates/regression.js";
import { t } from "../i18n/index.js";
import { type Task, verificationScript } from "../tasks/schema.js";

const TRUST_FILE = "trust.json";

export async function requireTrust(
  ctx: CommandContext,
  config: Config,
  tasks: Task[],
): Promise<void> {
  if ((await readTextIfExists(trustPath(ctx.cwd))) !== undefined) return;
  const lines = trustedLines(config, tasks);
  ctx.prompter.note(lines.join("\n"), t("trust.title"));
  if (ctx.prompter.canAsk?.() === false) {
    ctx.prompter.warn(t("trust.noTerminal", { command: `${CLI} next` }));
    throw new ExitCode(1);
  }
  if (!(await ctx.prompter.confirm(t("trust.confirm"), false))) {
    ctx.prompter.outro(t("trust.declined", { command: `${CLI} next` }));
    throw new ExitCode(1);
  }
  await recordTrust(ctx.cwd, lines);
}

export async function recordTrust(cwd: string, lines: string[] = []): Promise<void> {
  const commands = createHash("sha256").update(lines.join("\n")).digest("hex");
  const record = { approvedAt: new Date().toISOString(), commands };
  await writeState(trustPath(cwd), `${JSON.stringify(record, null, 2)}\n`);
}

function trustedLines(config: Config, tasks: Task[]): string[] {
  const suite = suiteCommands(config).map((item) => `  $ ${item.command}`);
  const checks = tasks
    .filter((task) => task.meta.status !== "done")
    .flatMap((task) => [
      `  ${task.meta.id} · ${task.meta.title}`,
      ...verificationScript(task.body)
        .filter((line) => line.trim() !== "")
        .map((line) => `    $ ${line}`),
    ]);
  const allowed = config.verify.allow.map((prefix) => `  ${prefix}`);
  return [
    ...(suite.length > 0 ? [t("trust.suite"), ...suite] : []),
    ...(checks.length > 0 ? [t("trust.checks"), ...checks] : []),
    ...(allowed.length > 0 ? [t("trust.allowed"), ...allowed] : []),
  ];
}

function trustPath(cwd: string): string {
  return join(repoState(cwd), TRUST_FILE);
}
