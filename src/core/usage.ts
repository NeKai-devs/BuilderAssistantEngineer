import type { Backend } from "../backends/types.js";
import type { Backend as BackendName } from "../config/schema.js";

export type Usage = {
  startedAt: number;
  costUsd: number;
  priced: number;
  unpriced: number;
  unpricedBy: string[];
};

export type UsageMark = Pick<Usage, "costUsd" | "priced" | "unpriced">;

export function newUsage(now = Date.now()): Usage {
  return { startedAt: now, costUsd: 0, priced: 0, unpriced: 0, unpricedBy: [] };
}

export function metered(
  create: (name: BackendName) => Backend,
  usage: Usage,
): (name: BackendName) => Backend {
  return (name) => {
    const backend = create(name);
    return {
      ...backend,
      run: async (prompt, options) => {
        let cost: number | undefined;
        try {
          return await backend.run(prompt, {
            ...options,
            onInfo: (info) => {
              if (info.costUsd !== undefined) cost = (cost ?? 0) + info.costUsd;
              options.onInfo?.(info);
            },
          });
        } finally {
          if (cost !== undefined) {
            usage.costUsd += cost;
            usage.priced++;
          } else {
            usage.unpriced++;
            if (!usage.unpricedBy.includes(backend.name)) usage.unpricedBy.push(backend.name);
          }
        }
      },
    };
  };
}

export function mark(usage: Usage | undefined): UsageMark {
  return {
    costUsd: usage?.costUsd ?? 0,
    priced: usage?.priced ?? 0,
    unpriced: usage?.unpriced ?? 0,
  };
}

export function costSince(usage: Usage | undefined, before: UsageMark): number | undefined {
  if (!usage || usage.unpriced > before.unpriced || usage.priced === before.priced)
    return undefined;
  return usage.costUsd - before.costUsd;
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
