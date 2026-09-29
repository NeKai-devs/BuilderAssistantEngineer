import { z } from "zod";
import type { Config } from "../config/schema.js";
import { bashPath, runScript } from "../core/bash.js";
import type { ShellResult } from "../core/process.js";
import { missingTool } from "./absent.js";
import { goText, probeFor, REPORT_SOURCES } from "./reports.js";
import {
  type Counts,
  cargoUnits,
  countsSchema,
  errorLines,
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
  ShellResult & {
    counts?: Counts;
    failing?: string[];
    source?: string;
    unrecognized?: boolean;
    units?: string[];
    errors?: string[];
    absent?: boolean;
  };

export const commandBaselineSchema = z.object({
  exitCode: z.number(),
  counts: countsSchema.optional(),
  failing: z.array(z.string()).optional(),
  source: z.string().optional(),
  units: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
  absent: z.boolean().optional(),
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
  | "absent"
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
export const COMMAND_NOT_FOUND = 127;
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
  absent:
    "not there yet: the tool or script it runs did not exist before the task and still does not; once a task creates it, it must pass",
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
    const errors = !test && result.exitCode !== 0 ? errorLines(output) : [];
    const absent = result.exitCode > 0 && missingTool(item.command, output);
    return {
      ...item,
      exitCode: result.exitCode,
      output,
      ...read,
      ...(errors.length > 0 ? { errors } : {}),
      ...(absent ? { absent } : {}),
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
): { counts?: Counts; failing?: string[]; source?: string; units?: string[] } {
  if (test && hint.length === 0) return {};
  const summary = parseSummary(output, hint);
  const failing = parseFailing(output, hint);
  const units = hint.includes("cargo") ? cargoUnits(output) : [];
  return {
    ...(summary ? { counts: summary.counts, source: summary.source } : {}),
    ...(failing ? { failing } : {}),
    ...(units.length > 0 ? { units } : {}),
  };
}

export function baselineFrom(
  results: SuiteResult[],
  excluded: string[] = [],
  absent: string[] = [],
): SuiteBaseline {
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
          ...(result.units ? { units: result.units } : {}),
          ...(result.errors ? { errors: result.errors } : {}),
          ...(absent.includes(result.command) ? { absent: true } : {}),
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
    return result.exitCode !== 0 && !result.errors;
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
  if (before?.absent && result.absent) return "absent";
  if (!before) return red ? "noBaseline" : "passed";
  const wasRed = before.exitCode !== 0 || (before.counts?.failed ?? 0) > 0;
  if (!wasRed) return red ? "regression" : "passed";
  if (!red) return "passed";
  if (before.failing && result.failing) {
    const known = new Set(before.failing);
    if (result.failing.some((name) => !known.has(name))) return "regression";
  }
  if (before.units && result.units && before.units.some((unit) => !result.units?.includes(unit))) {
    return "regression";
  }
  if (!before.counts && before.errors && result.errors && result.key !== "test") {
    const known = new Set(before.errors);
    return result.errors.some((line) => !known.has(line)) ? "regression" : "preexisting";
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
  if (!before?.counts || before.source === result.source) return false;
  return !(isReport(before.source) && isReport(result.source));
}

function isReport(source: string | undefined): boolean {
  return (REPORT_SOURCES as readonly (string | undefined)[]).includes(source);
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
