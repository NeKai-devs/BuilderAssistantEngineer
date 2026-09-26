import { join } from "node:path";
import { z } from "zod";
import type { Config } from "../config/schema.js";
import { bashPath, runScript } from "../core/bash.js";
import { readTextIfExists } from "../core/fs.js";
import { asRecord, parseObject } from "../core/json.js";
import type { ShellResult } from "../core/process.js";
import { expandScripts } from "./protected-files.js";
import { type Counts, countsSchema, parseFailing, parseSummary, runnerHint } from "./results.js";

export const SUITE_KEYS = ["lint", "typecheck", "build", "test"] as const;
export type SuiteKey = (typeof SUITE_KEYS)[number];
export type SuiteCommand = { key: SuiteKey; command: string };
export type SuiteResult = SuiteCommand &
  ShellResult & { counts?: Counts; failing?: string[]; source?: string };

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
  | "mustPass";
export type SuiteCheck = SuiteResult & { verdict: Verdict; before?: CommandBaseline };
export type RegressionCheck = {
  passed: boolean;
  checks: SuiteCheck[];
  regressions: SuiteCheck[];
  preexisting: SuiteCheck[];
  report: string;
};

const OUTPUT_TAIL = 3_000;
const BLOCKING = new Set<Verdict>([
  "regression",
  "unfinished",
  "noBaseline",
  "uncomparable",
  "mustPass",
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
  const scripts = asRecord(
    parseObject((await readTextIfExists(join(cwd, "package.json"))) ?? "")?.scripts,
  );
  for (const item of suite) {
    onOutput?.(`$ ${item.command}\n`);
    const result = bash
      ? await runScript(bash, `set -o pipefail\nexport CI=true\n${item.command}\n`, {
          cwd,
          onOutput,
          ...(timeoutMs ? { timeoutMs } : {}),
        })
      : { exitCode: -1, output: "bash was not found" };
    const hint = runnerHint(expandScripts(item.command, scripts));
    const summary = parseSummary(result.output, hint);
    const counts = summary?.counts;
    const failing = parseFailing(result.output, hint);
    results.push({
      ...item,
      ...result,
      ...(counts ? { counts, source: summary?.source } : {}),
      ...(failing ? { failing } : {}),
    });
  }
  return results;
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
  return results.filter(
    (result) =>
      result.exitCode === -1 ||
      (result.exitCode !== 0 && !result.counts && !(fix && result.key === "test")),
  );
}

export function verdictOf(
  result: SuiteResult,
  before: CommandBaseline | undefined,
  fix: boolean,
): Verdict {
  if (result.exitCode === -1) return "unfinished";
  const red = result.exitCode !== 0 || (result.counts?.failed ?? 0) > 0;
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
): RegressionCheck {
  const checks = results.map((result) => {
    const before = baseline?.commands[result.command];
    return { ...result, verdict: verdictOf(result, before, fix), ...(before ? { before } : {}) };
  });
  const regressions = checks.filter((check) => BLOCKING.has(check.verdict));
  return {
    passed: regressions.length === 0,
    checks,
    regressions,
    preexisting: checks.filter((check) => check.verdict === "preexisting"),
    report: ["## Regression check", ...checks.map(describe)].join("\n\n"),
  };
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
