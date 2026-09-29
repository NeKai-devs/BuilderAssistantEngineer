import { join } from "node:path";
import type { RunInfo } from "../backends/types.js";
import { writeText } from "../core/fs.js";
import { baePaths } from "../core/paths.js";
import type { ParsedPlan } from "./parser.js";

export type PlanStats = {
  backend: string;
  models: string[];
  costUsd?: number;
  continuations: number;
  formatRetries: number;
  formatErrors: string[];
  evidenceRetries: number;
  unverifiedPaths: string[];
  repairs: string[];
  nonPlanAnswers: number;
  verificationRetries: number;
  needsReview: string[];
};

export type PlanReport = PlanStats & {
  ok: boolean;
  files: number;
  tasks: number;
  questions: number;
  blockingQuestions: number;
  warnings: string[];
  error?: string;
};

export const PLAN_REPORT = "plan-report.json";

export function newPlanStats(backend: string): PlanStats {
  return {
    backend,
    models: [],
    continuations: 0,
    formatRetries: 0,
    formatErrors: [],
    evidenceRetries: 0,
    unverifiedPaths: [],
    repairs: [],
    nonPlanAnswers: 0,
    verificationRetries: 0,
    needsReview: [],
  };
}

export function recordInfo(stats: PlanStats, info: RunInfo): void {
  if (info.model && !stats.models.includes(info.model)) stats.models.push(info.model);
  if (info.costUsd !== undefined) stats.costUsd = (stats.costUsd ?? 0) + info.costUsd;
}

export async function writePlanReport(
  cwd: string,
  stats: PlanStats,
  parsed: ParsedPlan | undefined,
  error?: unknown,
): Promise<void> {
  const report: PlanReport = {
    ...stats,
    ok: parsed !== undefined,
    files: parsed?.files.length ?? 0,
    tasks: parsed?.tasks.length ?? 0,
    questions: parsed?.questions.length ?? 0,
    blockingQuestions: parsed?.questions.filter((question) => question.blocking).length ?? 0,
    warnings: parsed?.warnings ?? [],
    ...(error === undefined
      ? {}
      : { error: error instanceof Error ? error.message : String(error) }),
  };
  await writeText(join(baePaths(cwd).tmp, PLAN_REPORT), `${JSON.stringify(report, null, 2)}\n`);
}
