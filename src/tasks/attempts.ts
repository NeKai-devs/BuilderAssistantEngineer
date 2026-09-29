import { join } from "node:path";
import { readTextIfExists } from "../core/fs.js";
import { asRecord } from "../core/json.js";
import { appendState } from "../core/state.js";
import { runDir } from "./runs.js";

export const GATE_STAGES = [
  "agent",
  "contract",
  "refused",
  "declined",
  "verification",
  "regression",
  "integrity",
  "handoff",
  "review",
] as const;
export type GateStage = (typeof GATE_STAGES)[number];
export type AttemptOutcome = "done" | "failed" | "blocked";

export type Attempt = {
  startedAt: string;
  durationMs: number;
  costUsd?: number;
  headless: boolean;
  outcome: AttemptOutcome;
  stage?: GateStage;
  regressions: string[];
  reason?: string;
  skips?: string[];
  accepted?: string[];
};

export type Stop = { at: string; stage: GateStage; reason: string };

export const MAX_ATTEMPTS = 3;

const ATTEMPTS_FILE = "attempts.jsonl";
const STOPS_FILE = "stops.jsonl";
const OUTCOMES = new Set<string>(["done", "failed", "blocked"]);

export async function recordAttempt(cwd: string, id: string, attempt: Attempt): Promise<void> {
  await appendState(join(runDir(cwd, id), ATTEMPTS_FILE), `${JSON.stringify(attempt)}\n`);
}

export async function recordStop(cwd: string, id: string, stop: Stop): Promise<void> {
  await appendState(join(runDir(cwd, id), STOPS_FILE), `${JSON.stringify(stop)}\n`);
}

export async function lastStop(cwd: string, id: string): Promise<Stop | undefined> {
  const text = (await readTextIfExists(join(runDir(cwd, id), STOPS_FILE))) ?? "";
  const stops = text.split(/\r?\n/).flatMap((line) => {
    const stop = toStop(line);
    return stop ? [stop] : [];
  });
  const last = stops.at(-1);
  if (!last) return undefined;
  const attempts = await readAttempts(cwd, id);
  const since = attempts.at(-1)?.startedAt ?? "";
  return last.at > since ? last : undefined;
}

export async function readAttempts(cwd: string, id: string): Promise<Attempt[]> {
  const text = (await readTextIfExists(join(runDir(cwd, id), ATTEMPTS_FILE))) ?? "";
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      const attempt = toAttempt(line);
      return attempt ? [attempt] : [];
    });
}

function toAttempt(line: string): Attempt | undefined {
  let data: Record<string, unknown>;
  try {
    data = asRecord(JSON.parse(line));
  } catch {
    return undefined;
  }
  if (typeof data.startedAt !== "string" || !OUTCOMES.has(String(data.outcome))) return undefined;
  const stage = GATE_STAGES.find((value) => value === data.stage);
  return {
    startedAt: data.startedAt,
    durationMs: typeof data.durationMs === "number" ? data.durationMs : 0,
    ...(typeof data.costUsd === "number" ? { costUsd: data.costUsd } : {}),
    headless: data.headless === true,
    outcome: data.outcome as AttemptOutcome,
    ...(stage ? { stage } : {}),
    regressions: strings(data.regressions),
    ...(typeof data.reason === "string" ? { reason: data.reason } : {}),
    ...(Array.isArray(data.skips) ? { skips: strings(data.skips) } : {}),
    ...(Array.isArray(data.accepted) ? { accepted: strings(data.accepted) } : {}),
  };
}

function toStop(line: string): Stop | undefined {
  let data: Record<string, unknown>;
  try {
    data = asRecord(JSON.parse(line));
  } catch {
    return undefined;
  }
  const stage = GATE_STAGES.find((value) => value === data.stage);
  if (typeof data.at !== "string" || typeof data.reason !== "string" || !stage) return undefined;
  return { at: data.at, stage, reason: data.reason };
}

export function sinceBlocked(attempts: Attempt[]): Attempt[] {
  const last = attempts.map((attempt) => attempt.outcome).lastIndexOf("blocked");
  return attempts.slice(last + 1);
}

export async function attemptsLeft(cwd: string, id: string): Promise<number> {
  return Math.max(0, MAX_ATTEMPTS - sinceBlocked(await readAttempts(cwd, id)).length);
}

export async function blockedReason(cwd: string, id: string): Promise<string | undefined> {
  const stop = await lastStop(cwd, id);
  if (stop?.stage === "refused") return stop.reason;
  return (await readAttempts(cwd, id)).filter((attempt) => attempt.outcome === "blocked").at(-1)
    ?.reason;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}
