import { z } from "zod";
import type { Config } from "../config/schema.js";
import { runShell, type ShellResult } from "../core/process.js";

export const SUITE_KEYS = ["lint", "test"] as const;
export type SuiteKey = (typeof SUITE_KEYS)[number];
export type SuiteCommand = { key: SuiteKey; command: string };
export type SuiteResult = SuiteCommand & ShellResult;
export const suiteBaselineSchema = z.object({
  skipped: z.boolean(),
  exitCodes: z.object({ lint: z.number().optional(), test: z.number().optional() }),
});
export type SuiteBaseline = z.output<typeof suiteBaselineSchema>;
export type RegressionCheck = {
  passed: boolean;
  regressions: SuiteResult[];
  preexisting: SuiteResult[];
  report: string;
};

const OUTPUT_TAIL = 3_000;

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
  known: Map<string, ShellResult> = new Map(),
): Promise<SuiteResult[]> {
  const results: SuiteResult[] = [];
  for (const item of suite) {
    const reused = known.get(item.command);
    if (!reused) onOutput?.(`$ ${item.command}\n`);
    results.push({ ...item, ...(reused ?? (await runShell(item.command, { cwd, onOutput }))) });
  }
  return results;
}

export function failingBefore(
  suite: SuiteCommand[],
  baseline: SuiteBaseline | undefined,
): Set<string> {
  const failing = suite.filter((item) => (baseline?.exitCodes[item.key] ?? 0) !== 0);
  return new Set(failing.map((item) => item.command));
}

export function checkRegressions(
  results: SuiteResult[],
  baseline: SuiteBaseline | undefined,
): RegressionCheck {
  const failed = results.filter((result) => result.exitCode !== 0);
  const preexisting = failed.filter((result) => (baseline?.exitCodes[result.key] ?? 0) !== 0);
  const regressions = failed.filter((result) => !preexisting.includes(result));
  const lines = results.map((result) => describe(result, baseline, preexisting.includes(result)));
  return {
    passed: regressions.length === 0,
    regressions,
    preexisting,
    report: ["## Regression check", ...lines].join("\n\n"),
  };
}

export function baselineFrom(results: SuiteResult[]): SuiteBaseline {
  return {
    skipped: false,
    exitCodes: Object.fromEntries(results.map((result) => [result.key, result.exitCode])),
  };
}

function describe(
  result: SuiteResult,
  baseline: SuiteBaseline | undefined,
  preexisting: boolean,
): string {
  const head = `$ ${result.command} (${result.key}, exit ${result.exitCode})`;
  if (result.exitCode === 0) return head;
  const verdict = preexisting
    ? "preexisting: it already failed before the task, so it does not block"
    : baseline?.exitCodes[result.key] === 0
      ? "regression: it passed before the task"
      : "regression: there is no passing baseline for it";
  const output = result.output.slice(-OUTPUT_TAIL).trim();
  return `${head} ${verdict}\n\n\`\`\`text\n${output}\n\`\`\``;
}
