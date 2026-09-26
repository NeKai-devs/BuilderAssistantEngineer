import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readTextIfExists } from "../core/fs.js";
import { asRecord } from "../core/json.js";
import { runDir } from "./runs.js";

export const GATE_STAGES = [
  "refused",
  "declined",
  "verification",
  "regression",
  "handoff",
  "review",
] as const;
export type GateStage = (typeof GATE_STAGES)[number];
export type AttemptOutcome = "done" | "failed" | "blocked";

export type Attempt = {
  startedAt: string;
  durationMs: number;
  headless: boolean;
  outcome: AttemptOutcome;
  stage?: GateStage;
  regressions: string[];
};

const ATTEMPTS_FILE = "attempts.jsonl";
const OUTCOMES = new Set<string>(["done", "failed", "blocked"]);

export async function recordAttempt(cwd: string, id: string, attempt: Attempt): Promise<void> {
  const dir = runDir(cwd, id);
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, ATTEMPTS_FILE), `${JSON.stringify(attempt)}\n`, "utf8");
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
    headless: data.headless === true,
    outcome: data.outcome as AttemptOutcome,
    ...(stage ? { stage } : {}),
    regressions: Array.isArray(data.regressions) ? data.regressions.map(String) : [],
  };
}
