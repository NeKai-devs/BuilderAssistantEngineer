import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";

export const CALLS_ENV = "BAE_EVAL_CALLS";

export type CallStats = {
  calls: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
};

type Usage = Omit<CallStats, "calls">;

const NO_USAGE: Usage = {
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  costUsd: 0,
};

export async function claudeWrapper(dir: string): Promise<string | undefined> {
  if (process.platform === "win32") return undefined;
  const found = await execa("bash", ["-c", "command -v claude"], { reject: false });
  const real = found.stdout.trim();
  if (found.exitCode !== 0 || real === "") return undefined;
  await mkdir(dir, { recursive: true });
  const script = [
    "#!/usr/bin/env bash",
    "set -o pipefail",
    `real=${JSON.stringify(real)}`,
    `if [ -z "\${${CALLS_ENV}:-}" ] || [[ " $* " != *" -p "* ]]; then exec "$real" "$@"; fi`,
    `mkdir -p "$${CALLS_ENV}"`,
    `"$real" "$@" | tee "$${CALLS_ENV}/$(date +%s%N)-$$.jsonl"`,
    "",
  ].join("\n");
  const path = join(dir, "claude");
  await writeFile(path, script);
  await chmod(path, 0o755);
  return dir;
}

export async function collectCalls(dir: string, target: string): Promise<CallStats> {
  const names = (await readdir(dir).catch(() => [] as string[])).sort();
  const events = await Promise.all(names.map((name) => lastResult(join(dir, name))));
  const results = events.filter((event) => event !== undefined);
  await writeFile(target, results.map((event) => `${JSON.stringify(event)}\n`).join(""));
  await rm(dir, { recursive: true, force: true });
  return { calls: results.length, ...results.map(usageOf).reduce(addUsage, NO_USAGE) };
}

export function sumCalls(stats: CallStats[]): CallStats {
  const calls = stats.reduce((total, item) => total + item.calls, 0);
  return { calls, ...stats.map(usageOnly).reduce(addUsage, NO_USAGE) };
}

async function lastResult(path: string): Promise<Record<string, unknown> | undefined> {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  const results = lines.filter((line) => line.includes('"type":"result"')).flatMap(parseLine);
  return results.at(-1);
}

function parseLine(line: string): Record<string, unknown>[] {
  try {
    return [record(JSON.parse(line))];
  } catch {
    return [];
  }
}

function usageOf(event: Record<string, unknown>): Usage {
  const models = Object.values(record(event.modelUsage)).map(record);
  const sum = (key: string) => models.reduce((total, model) => total + number(model[key]), 0);
  return {
    inputTokens: sum("inputTokens"),
    cacheWriteTokens: sum("cacheCreationInputTokens"),
    cacheReadTokens: sum("cacheReadInputTokens"),
    outputTokens: sum("outputTokens"),
    costUsd: number(event.total_cost_usd),
  };
}

function usageOnly({ calls: _calls, ...usage }: CallStats): Usage {
  return usage;
}

function addUsage(total: Usage, item: Usage): Usage {
  return {
    inputTokens: total.inputTokens + item.inputTokens,
    cacheWriteTokens: total.cacheWriteTokens + item.cacheWriteTokens,
    cacheReadTokens: total.cacheReadTokens + item.cacheReadTokens,
    outputTokens: total.outputTokens + item.outputTokens,
    costUsd: total.costUsd + item.costUsd,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function number(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
