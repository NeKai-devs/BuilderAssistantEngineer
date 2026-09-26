import { readFileSync } from "node:fs";
import { Command, CommanderError, Option } from "commander";
import pc from "picocolors";
import { BACKENDS } from "./config/schema.js";
import { resolveSettings } from "./config/settings.js";
import { readConfig } from "./config/store.js";
import { UserError } from "./core/errors.js";
import { isLang, LANGS, type Lang, setLang, t } from "./i18n/index.js";

const ONLY_GROUPS = ["plan", "agents", "memory"] as const;

export async function main(argv: string[], cwd: string): Promise<number> {
  const config = await readConfig(cwd).catch(() => undefined);
  setLang(resolveSettings({ lang: scanLang(argv) }, config).lang);
  try {
    await buildProgram().parseAsync(argv);
    return 0;
  } catch (error) {
    return report(error);
  }
}

export function buildProgram(): Command {
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

  program.command("init").description(t("command.init")).action(notImplemented("init"));
  program
    .command("plan")
    .description(t("command.plan"))
    .addOption(new Option("--only <group>", t("option.only")).choices(ONLY_GROUPS))
    .action(notImplemented("plan"));
  program
    .command("next")
    .description(t("command.next"))
    .option("--headless", t("option.headless"))
    .action(notImplemented("next"));
  program.command("status").description(t("command.status")).action(notImplemented("status"));
  program.command("replan").description(t("command.replan")).action(notImplemented("replan"));
  program
    .command("review")
    .description(t("command.review"))
    .argument("[task]", t("argument.task"))
    .action(notImplemented("review"));

  return program;
}

export function scanLang(argv: string[]): Lang | undefined {
  const index = argv.findIndex((arg) => arg === "--lang" || arg.startsWith("--lang="));
  if (index === -1) return undefined;
  const arg = argv[index] ?? "";
  const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
  return isLang(value) ? value : undefined;
}

function notImplemented(command: string) {
  return () => {
    throw new UserError(t("error.notImplemented", { command }));
  };
}

function report(error: unknown): number {
  if (error instanceof CommanderError) return error.exitCode;
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
