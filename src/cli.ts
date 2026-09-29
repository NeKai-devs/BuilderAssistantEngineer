import { readFileSync } from "node:fs";
import { Command, CommanderError, Option } from "commander";
import pc from "picocolors";
import { type CommandContext, type CommandDeps, defaultDeps } from "./commands/context.js";
import { type InitOptions, runInit } from "./commands/init.js";
import { type NextOptions, runNext } from "./commands/next.js";
import { type PlanOptions, runPlan } from "./commands/plan.js";
import { type ReplanOptions, runReplan } from "./commands/replan.js";
import { type ReviewOptions, runReview } from "./commands/review.js";
import { runStatus } from "./commands/status.js";
import { BACKENDS } from "./config/schema.js";
import { type GlobalFlags, resolveSettings } from "./config/settings.js";
import { readConfig } from "./config/store.js";
import { ExitCode, UserError } from "./core/errors.js";
import { withLock } from "./core/lock.js";
import { projectRoot } from "./core/root.js";
import { formatCost, metered, newUsage, type Usage } from "./core/usage.js";
import { isLang, LANGS, type Lang, setLang, t } from "./i18n/index.js";
import { ONLY_GROUPS } from "./plan/filter.js";
import { formatDuration } from "./tasks/metrics.js";

export async function main(
  argv: string[],
  cwd: string,
  deps: Partial<CommandDeps> = {},
): Promise<number> {
  const root = await projectRoot(cwd);
  const config = await readConfig(root).catch(() => undefined);
  setLang(resolveSettings({ lang: scanLang(argv) }, config).lang);
  const merged = { ...defaultDeps(), ...deps };
  const usage = merged.usage ?? newUsage();
  const run = { ...merged, usage, createBackend: metered(merged.createBackend, usage) };
  try {
    await buildProgram(run, root, cwd).parseAsync(argv);
    printUsage(run.print, usage);
    return 0;
  } catch (error) {
    const code = report(error);
    printUsage(run.print, usage);
    return code;
  }
}

function printUsage(print: (text: string) => void, usage: Usage): void {
  if (usage.priced + usage.unpriced === 0) return;
  const time = formatDuration(Date.now() - usage.startedAt);
  const names = usage.unpricedBy.join(", ");
  const cost =
    usage.unpriced === 0
      ? formatCost(usage.costUsd)
      : usage.priced === 0
        ? t("usage.notReported", { names })
        : t("usage.partlyReported", { cost: formatCost(usage.costUsd), names });
  print(`${pc.dim(t("usage.summary", { time, cost }))}\n`);
}

export function buildProgram(deps: CommandDeps, root: string, cwd = root): Command {
  const context = (command: Command, at = root): CommandContext => ({
    ...deps,
    cwd: at,
    flags: command.optsWithGlobals() as GlobalFlags,
  });
  const program = new Command("builder-assistant-engineer")
    .description(t("program.description"))
    .exitOverride()
    .version(readVersion(), "-v, --version", t("option.version"))
    .helpOption("-h, --help", t("option.help"))
    .helpCommand("help [command]", t("command.help"))
    .addOption(new Option("--backend <name>", t("option.backend")).choices(BACKENDS))
    .addOption(new Option("--lang <code>", t("option.lang")).choices(LANGS))
    .option("--dry-run", t("option.dryRun"))
    .option("-y, --yes", t("option.yes"));

  program
    .command("init")
    .description(t("command.init"))
    .option("--brief <paths>", t("option.brief"))
    .action((options: InitOptions, command: Command) => runInit(context(command, cwd), options));
  program
    .command("plan")
    .description(t("command.plan"))
    .addOption(new Option("--only <group>", t("option.only")).choices(ONLY_GROUPS))
    .option("--no-verify", t("option.noVerify"))
    .action((options: PlanOptions, command: Command) =>
      withLock(root, "plan", () => runPlan(context(command), options)),
    );
  program
    .command("next")
    .description(t("command.next"))
    .option("--headless", t("option.headless"))
    .option("--accept-finding <id>", t("option.acceptFinding"), collect, [])
    .option("--allow-skip", t("option.allowSkip"))
    .option("--allow-dirty", t("option.allowDirty"))
    .option("--new-run", t("option.newRun"))
    .option("--no-verify", t("option.noVerify"))
    .action((options: NextOptions, command: Command) =>
      withLock(root, "next", () => runNext(context(command), options)),
    );
  program
    .command("status")
    .description(t("command.status"))
    .action((_options: unknown, command: Command) => runStatus(context(command)));
  program
    .command("replan")
    .description(t("command.replan"))
    .option("--no-verify", t("option.noVerify"))
    .action((options: ReplanOptions, command: Command) =>
      withLock(root, "replan", () => runReplan(context(command), options)),
    );
  program
    .command("review")
    .description(t("command.review"))
    .argument("[task]", t("argument.task"))
    .option("--accept-finding <id>", t("option.acceptFinding"), collect, [])
    .action((task: string | undefined, options: ReviewOptions, command: Command) =>
      runReview(context(command), task, options),
    );

  return program;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function scanLang(argv: string[]): Lang | undefined {
  const index = argv.findIndex((arg) => arg === "--lang" || arg.startsWith("--lang="));
  if (index === -1) return undefined;
  const arg = argv[index] ?? "";
  const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
  return isLang(value) ? value : undefined;
}

function report(error: unknown): number {
  if (error instanceof CommanderError) return error.exitCode;
  if (error instanceof ExitCode) return error.code;
  if (error instanceof UserError) {
    process.stderr.write(`${pc.red(error.message)}\n`);
    return 1;
  }
  process.stderr.write(`${pc.red(t("error.unexpected"))}\n`);
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  return 1;
}

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return (pkg as { version: string }).version;
}
