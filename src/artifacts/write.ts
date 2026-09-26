import { join } from "node:path";
import type { CommandContext } from "../commands/context.js";
import { writeText } from "../core/fs.js";
import { t } from "../i18n/index.js";
import { describeChanges, renderDiff } from "./diff.js";
import type { Change } from "./merge.js";

type Decision = "all" | "each" | "none";

export async function confirmChanges(ctx: CommandContext, changes: Change[]): Promise<Change[]> {
  if (changes.length === 0) return [];
  ctx.prompter.note(describeChanges(changes), t("artifacts.changes"));
  const pending = changes.filter((change) => change.kind === "create" || change.kind === "update");
  if (pending.length === 0) return [];
  for (const change of pending.filter((candidate) => candidate.kind === "update")) {
    ctx.print(`${renderDiff(change)}\n`);
  }
  if (ctx.flags.yes) return pending;
  const decision = await ctx.prompter.select<Decision>(
    t("artifacts.confirm", { count: pending.length }),
    [
      { value: "all", label: t("artifacts.all") },
      { value: "each", label: t("artifacts.each") },
      { value: "none", label: t("artifacts.none") },
    ],
    "all",
  );
  if (decision === "none") return [];
  if (decision === "all") return pending;
  const accepted: Change[] = [];
  for (const change of pending) {
    if (await ctx.prompter.confirm(t("artifacts.confirmOne", { path: change.path }), true)) {
      accepted.push(change);
    }
  }
  return accepted;
}

export async function applyChanges(cwd: string, changes: Change[]): Promise<void> {
  for (const change of changes) {
    await writeText(join(cwd, ...change.path.split("/")), change.after);
  }
}
