import { createTwoFilesPatch } from "diff";
import pc from "picocolors";
import { t } from "../i18n/index.js";
import type { Change } from "./merge.js";

export function renderDiff(change: Change): string {
  return patchLines(change).map(colorize).join("\n");
}

function patchLines(change: Change): string[] {
  const patch = createTwoFilesPatch(
    `a/${change.path}`,
    `b/${change.path}`,
    change.before ?? "",
    change.after,
    "",
    "",
    { context: 3 },
  );
  return patch.split("\n").filter((line) => !line.startsWith("====="));
}

export function describeChanges(changes: Change[]): string {
  return changes.map(describe).join("\n");
}

function describe(change: Change): string {
  if (change.kind === "create") {
    return `${pc.green("+")} ${change.path} (${t("artifacts.new", { lines: lineCount(change.after) })})`;
  }
  if (change.kind === "update") {
    const { added, removed } = countChanges(change);
    return `${pc.yellow("~")} ${change.path} (${t("artifacts.updated", { added, removed })})`;
  }
  if (change.kind === "keep") return `${pc.cyan("!")} ${change.path} (${t("artifacts.keptDone")})`;
  if (change.kind === "delete") return `${pc.red("-")} ${change.path} (${t("artifacts.removed")})`;
  return `${pc.dim("=")} ${change.path} (${t("artifacts.unchanged")})`;
}

function countChanges(change: Change) {
  const lines = patchLines(change);
  const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const removed = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  return { added, removed };
}

function colorize(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return pc.bold(line);
  if (line.startsWith("+")) return pc.green(line);
  if (line.startsWith("-")) return pc.red(line);
  if (line.startsWith("@@")) return pc.cyan(line);
  return line;
}

function lineCount(text: string): number {
  return text.trimEnd().split("\n").length;
}
