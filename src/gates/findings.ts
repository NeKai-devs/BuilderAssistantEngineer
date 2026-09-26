import { createHash } from "node:crypto";
import type { ReviewFinding } from "../review/parse.js";

export type Acceptance = { ids: ReadonlySet<string>; accepted: ReviewFinding[] };

export function findingId(kind: string, ...parts: string[]): string {
  const hash = createHash("sha1")
    .update([kind, ...parts].join("\u0000"))
    .digest("hex");
  return `${kind}-${hash.slice(0, 8)}`;
}

export function newAcceptance(ids: Iterable<string> = []): Acceptance {
  return { ids: new Set([...ids].map((id) => id.trim().toLowerCase())), accepted: [] };
}

export function accept(
  acceptance: Acceptance,
  finding: ReviewFinding,
  allowed: boolean,
): ReviewFinding {
  if (!allowed || !finding.id || !acceptance.ids.has(finding.id)) return finding;
  const accepted = { ...finding, severity: "minor" as const };
  acceptance.accepted.push(accepted);
  return accepted;
}
