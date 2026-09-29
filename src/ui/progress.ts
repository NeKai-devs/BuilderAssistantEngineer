import type { Progress } from "../backends/types.js";
import { type MessageKey, t } from "../i18n/index.js";

const TOOL_KEYS: Record<string, MessageKey> = {
  Read: "progress.read",
  Grep: "progress.search",
  Glob: "progress.search",
  Bash: "progress.run",
  Edit: "progress.edit",
  MultiEdit: "progress.edit",
  Write: "progress.edit",
  NotebookEdit: "progress.edit",
};

export function describeProgress(progress: Progress): string | undefined {
  if (progress.type === "thinking") return t("progress.thinking");
  if (progress.type === "text") return undefined;
  const key = TOOL_KEYS[progress.tool];
  return key
    ? t(key, { detail: progress.detail })
    : t("progress.tool", { tool: progress.tool, detail: progress.detail });
}
