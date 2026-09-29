import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { CommandContext } from "../commands/context.js";
import { CLI } from "../commands/shared.js";
import type { Config } from "../config/schema.js";
import { ExitCode } from "../core/errors.js";
import { readTextIfExists } from "../core/fs.js";
import { repoState, writeState } from "../core/state.js";
import { suiteCommands } from "../gates/regression.js";
import { t } from "../i18n/index.js";
import { type Task, verificationScript } from "../tasks/schema.js";
import { agentLoads } from "./agent-loads.js";

type Item = { key: string; section: "suite" | "checks" | "allowed"; lines: string[] };

const TRUST_FILE = "trust.json";
const SECTIONS = {
  suite: "trust.suite",
  checks: "trust.checks",
  allowed: "trust.allowed",
} as const;
const trustSchema = z.object({
  approved: z.array(z.string()).default([]),
  seen: z.array(z.string()).default([]),
});

export async function requireTrust(
  ctx: CommandContext,
  config: Config,
  tasks: Task[],
): Promise<void> {
  const stored = await readTrust(ctx.cwd);
  const approved = new Set(stored?.approved ?? []);
  const seen = new Set(stored?.seen ?? []);
  const items = trustItems(config, tasks);
  const fresh = items.filter((item) => !approved.has(hash(item.key)));
  const loads = await agentLoads(ctx.cwd);
  const unseen = loads.filter((line) => !seen.has(hash(line)));
  const record = () =>
    writeTrust(
      ctx.cwd,
      [...approved, ...items.map((item) => hash(item.key))],
      [...seen, ...loads.map(hash)],
    );
  if (fresh.length === 0) {
    if (unseen.length === 0) return;
    ctx.prompter.warn(`${t("trust.agentLoads")}\n${indent(unseen).join("\n")}`);
    await record();
    return;
  }
  const first = stored === undefined;
  ctx.prompter.note(
    screen(fresh, loads).join("\n"),
    t(first ? "trust.title" : "trust.changedTitle"),
  );
  if (ctx.prompter.canAsk?.() === false) {
    ctx.prompter.warn(t("trust.noTerminal", { command: `${CLI} next` }));
    throw new ExitCode(1);
  }
  if (!(await ctx.prompter.confirm(t(first ? "trust.confirm" : "trust.confirmChanged"), false))) {
    ctx.prompter.outro(t("trust.declined", { command: `${CLI} next` }));
    throw new ExitCode(1);
  }
  await record();
}

export function trustItems(config: Config, tasks: Task[]): Item[] {
  const suite = suiteCommands(config).map(
    (item): Item => ({
      key: `suite\0${item.key}\0${item.command}`,
      section: "suite",
      lines: [`  $ ${item.command}`],
    }),
  );
  const checks = tasks
    .filter((task) => task.meta.status !== "done")
    .map((task): Item => {
      const script = verificationScript(task.body).filter((line) => line.trim() !== "");
      return {
        key: `checks\0${task.meta.id}\0${script.join("\n")}`,
        section: "checks",
        lines: [`  ${task.meta.id} · ${task.meta.title}`, ...script.map((line) => `    $ ${line}`)],
      };
    });
  const allowed = config.verify.allow.map(
    (prefix): Item => ({ key: `allow\0${prefix}`, section: "allowed", lines: [`  ${prefix}`] }),
  );
  return [...suite, ...checks, ...allowed];
}

function screen(items: Item[], loads: string[]): string[] {
  const part = (section: Item["section"]) => {
    const lines = items.filter((item) => item.section === section).flatMap((item) => item.lines);
    return lines.length > 0 ? [t(SECTIONS[section]), ...lines] : [];
  };
  return [
    ...part("suite"),
    ...part("checks"),
    ...part("allowed"),
    ...(loads.length > 0 ? [t("trust.agentLoads"), ...indent(loads)] : []),
  ];
}

async function readTrust(cwd: string): Promise<z.output<typeof trustSchema> | undefined> {
  const text = await readTextIfExists(trustPath(cwd));
  if (text === undefined) return undefined;
  try {
    const parsed = trustSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : { approved: [], seen: [] };
  } catch {
    return { approved: [], seen: [] };
  }
}

async function writeTrust(cwd: string, approved: string[], seen: string[]): Promise<void> {
  const record = {
    approvedAt: new Date().toISOString(),
    approved: [...new Set(approved)].sort(),
    seen: [...new Set(seen)].sort(),
  };
  await writeState(trustPath(cwd), `${JSON.stringify(record, null, 2)}\n`);
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function indent(lines: string[]): string[] {
  return lines.map((line) => `  ${line}`);
}

function trustPath(cwd: string): string {
  return join(repoState(cwd), TRUST_FILE);
}
