import type { Target } from "../config/schema.js";
import type { PlanFile } from "./parser.js";

export const ONLY_GROUPS = ["plan", "agents", "memory"] as const;
export type OnlyGroup = (typeof ONLY_GROUPS)[number];

const MEMORY_FILES = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);

export function groupOf(path: string): OnlyGroup {
  if (MEMORY_FILES.has(path)) return "memory";
  return path.startsWith("docs/plan/") ? "plan" : "agents";
}

export function isTargeted(path: string, targets: Target[]): boolean {
  if (path === "CLAUDE.md" || path.startsWith(".claude/")) return targets.includes("claude-code");
  if (path === "GEMINI.md") return targets.includes("gemini");
  if (path.startsWith(".opencode/")) return targets.includes("opencode");
  return true;
}

export function selectFiles(
  files: PlanFile[],
  selection: { only?: OnlyGroup; targets: Target[] },
): PlanFile[] {
  return files.filter(
    (file) =>
      isTargeted(file.path, selection.targets) &&
      (selection.only === undefined || groupOf(file.path) === selection.only),
  );
}
