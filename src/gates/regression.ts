import { z } from "zod";
import type { Config } from "../config/schema.js";
import { bashPath, runScript } from "../core/bash.js";
import type { ShellResult } from "../core/process.js";
import { goText, probeFor } from "./reports.js";
import {
  type Counts,
  countsSchema,
  parseFailing,
  parseSummary,
  type RunnerName,
  runnerHint,
} from "./results.js";
import { expandCommand, readSources, type Sources, testRunners } from "./runners.js";

export const SUITE_KEYS = ["lint", "typecheck", "build", "test"] as const;
export type SuiteKey = (typeof SUITE_KEYS)[number];
export type SuiteCommand = { key: SuiteKey; command: string };
export type SuiteResult = SuiteCommand &
  ShellResult & { counts?: Counts; failing?: string[]; source?: string; unrecognized?: boolean };

export const commandBaselineSchema = z.object({
  exitCode: z.number(),
  counts: countsSchema.optional(),
  failing: z.array(z.string()).optional(),
  source: z.string().optional(),
});
export const suiteBaselineSchema = z.object({
  skipped: z.boolean().default(false),
  commands: z.record(z.string(), commandBaselineSchema).default({}),
  excluded: z.array(z.string()).default([]),
});
export type CommandBaseline = z.output<typeof commandBaselineSchema>;
export type SuiteBaseline = z.output<typeof suiteBaselineSchema>;

export type Verdict =
  | "passed"
  | "preexisting"
  | "regression"
  | "unfinished"
  | "noBaseline"
  | "uncomparable"
  | "mustPass"
  | "unknown";
export type SuiteCheck = SuiteResult & { verdict: Verdict; before?: CommandBaseline };
export type RegressionCheck = {
  passed: boolean;
  checks: SuiteCheck[];
  regressions: SuiteCheck[];
  preexisting: SuiteCheck[];
  unread: SuiteCheck[];
  report: string;
};

const OUTPUT_TAIL = 3_000;
const BLOCKING = new Set<Verdict>([
  "regression",
  "unfinished",
  "noBaseline",
  "uncomparable",
  "mustPass",
  "unknown",
]);
const VERDICTS: Record<Verdict, string> = {
  passed: "passed",
  preexisting: "preexisting: it already failed before the task and the task did not make it worse",
  regression: "regression: it passed before the task, or more checks fail than before",
  unfinished: "regression: it did not finish (timeout or could not start)",
  noBaseline: "regression: there is no passing baseline for it",
  uncomparable:
    "blocks: it already failed before the task and its output has no counts to compare, so only green passes",
  mustPass: "blocks: the task is tests: fix, so the test suite must end green",
  unknown: "blocks: bae could not read how many tests ran, so it cannot tell whether they passed",
};

export function suiteCommands(config: Config): SuiteCommand[] {
  if (config.gates.regression === "off") return [];
  return SUITE_KEYS.flatMap((key) => {
    const command = config.commands[key];
    return command ? [{ key, command }] : [];
  });
}

export async function runSuite(
  cwd: string,
  suite: SuiteCommand[],
  onOutput?: (chunk: string) => void,
  timeoutMs?: number,
): Promise<SuiteResult[]> {
  const results: SuiteResult[] = [];
  const bash = await bashPath();
  const sources = await readSources(cwd);
  for (const item of suite) {
    onOutput?.(`$ ${item.command}\n`);
    results.push(
      bash
        ? await runOne(bash, { cwd, item, sources, timeoutMs }, onOutput)
        : { ...item, exitCode: -1, output: "bash was not found" },
    );
  }
  return results;
}

async function runOne(
  bash: string,
  run: { cwd: string; item: SuiteCommand; sources: Sources; timeoutMs?: number | undefined },
  onOutput?: (chunk: string) => void,
): Promise<SuiteResult> {
  const { cwd, item, sources } = run;
  const test = item.key === "test";
  const hint = test
    ? testRunners(item.command, sources)
    : runnerHint(expandCommand(item.command, sources));
  const probe = test && hint.length > 0 ? await probeFor(cwd, item.command, sources) : undefined;
  try {
    const view = probe?.view?.();
    const shown =
      onOutput && view
        ? (chunk: string) => {
            const text = view.push(chunk);
            if (text) onOutput(text);
          }
        : onOutput;
    const result = await runScript(
      bash,
      `set -o pipefail\nexport CI=true\n${probe?.command ?? item.command}\n`,
      {
        cwd,
        ...(shown ? { onOutput: shown } : {}),
        ...(probe ? { env: probe.env } : {}),
        ...(run.timeoutMs ? { timeoutMs: run.timeoutMs } : {}),
      },
    );
    const rest = view?.end();
    if (rest) onOutput?.(rest);
    const output = view ? goText(result.output) : result.output;
    const read = (await probe?.collect(result.stdout)) ?? textRead(output, hint, test);
    return {
      ...item,
      exitCode: result.exitCode,
      output,
      ...read,
      ...(test && hint.length === 0 ? { unrecognized: true } : {}),
    };
  } finally {
    await probe?.dispose();
  }
}

function textRead(
  output: string,
  hint: RunnerName[],
  test: boolean,
): { counts?: Counts; failing?: string[]; source?: string } {
  if (test && hint.length === 0) return {};
  const summary = parseSummary(output, hint);
  const failing = parseFailing(output, hint);
  return {
    ...(summary ? { counts: summary.counts, source: summary.source } : {}),
    ...(failing ? { failing } : {}),
  };
}

export function baselineFrom(results: SuiteResult[], excluded: string[] = []): SuiteBaseline {
  return {
    skipped: false,
    excluded,
    commands: Object.fromEntries(
      results.map((result) => [
        result.command,
        {
          exitCode: result.exitCode,
          ...(result.counts ? { counts: result.counts } : {}),
          ...(result.failing ? { failing: result.failing } : {}),
          ...(result.source ? { source: result.source } : {}),
        },
      ]),
    ),
  };
}

export function unusableBaseline(results: SuiteResult[], fix: boolean): SuiteResult[] {
  return results.filter((result) => {
    if (result.exitCode === -1 || (result.key === "test" && result.unrecognized)) return true;
    if (result.counts) return false;
    if (result.key === "test") return !(fix && result.exitCode !== 0);
    return result.exitCode !== 0;
  });
}

export function verdictOf(
  result: SuiteResult,
  before: CommandBaseline | undefined,
  fix: boolean,
): Verdict {
  if (result.exitCode === -1) return "unfinished";
  const red = result.exitCode !== 0 || (result.counts?.failed ?? 0) > 0;
  if (result.key === "test" && !red && unread(result, before)) return "unknown";
  if (fix && result.key === "test") return red ? "mustPass" : "passed";
  if (!before) return red ? "noBaseline" : "passed";
  const wasRed = before.exitCode !== 0 || (before.counts?.failed ?? 0) > 0;
  if (!wasRed) return red ? "regression" : "passed";
  if (!red) return "passed";
  if (before.failing && result.failing) {
    const known = new Set(before.failing);
    if (result.failing.some((name) => !known.has(name))) return "regression";
  }
  if (!before.counts || !result.counts || before.source !== result.source) return "uncomparable";
  const worse =
    result.counts.failed > before.counts.failed || result.counts.passed < before.counts.passed;
  return worse ? "regression" : "preexisting";
}

export function checkRegressions(
  results: SuiteResult[],
  baseline: SuiteBaseline | undefined,
  fix: boolean,
  allowUnread = false,
): RegressionCheck {
  const checks = results.map((result) => {
    const before = baseline?.commands[result.command];
    return { ...result, verdict: verdictOf(result, before, fix), ...(before ? { before } : {}) };
  });
  const unread = checks.filter((check) => check.verdict === "unknown");
  const regressions = checks.filter(
    (check) => BLOCKING.has(check.verdict) && !(allowUnread && check.verdict === "unknown"),
  );
  return {
    passed: regressions.length === 0,
    checks,
    regressions,
    preexisting: checks.filter((check) => check.verdict === "preexisting"),
    unread,
    report: ["## Regression check", ...checks.map(describe)].join("\n\n"),
  };
}

function unread(result: SuiteResult, before: CommandBaseline | undefined): boolean {
  if (!result.counts) return true;
  return Boolean(before?.counts && before.source !== result.source);
}

export function blocking(verdict: Verdict): boolean {
  return BLOCKING.has(verdict);
}

function describe(check: SuiteCheck): string {
  const head = `$ ${check.command} (${check.key}, exit ${check.exitCode}${countsText(check)})`;
  if (check.verdict === "passed") return head;
  const output = check.output.slice(-OUTPUT_TAIL).trim();
  return `${head} ${VERDICTS[check.verdict]}\n\n\`\`\`text\n${output}\n\`\`\``;
}

function countsText(check: SuiteCheck): string {
  const now = check.counts ? formatCounts(check.counts) : "";
  const then = check.before?.counts ? formatCounts(check.before.counts) : "";
  if (!now) return "";
  return then ? `; ${now}, before: ${then}` : `; ${now}`;
}

export function formatCounts(counts: Counts): string {
  return `${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped`;
}
