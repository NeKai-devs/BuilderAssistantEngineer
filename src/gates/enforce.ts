import { join } from "node:path";
import type { CommandContext } from "../commands/context.js";
import { readTextIfExists } from "../core/fs.js";
import { flaggedFiles, git } from "../core/git.js";
import { asRecord, parseObject } from "../core/json.js";
import { type MessageKey, t } from "../i18n/index.js";
import type { ReviewFinding } from "../review/parse.js";
import { capturedTask, formatFindings } from "../review/run.js";
import { inScope, scopePaths } from "../review/scope.js";
import { exclusionKeys } from "../review/tests.js";
import type { Capture } from "./capture.js";
import {
  type ContractChange,
  type ContractKind,
  checkContract,
  isAcceptableKind,
  restoreContract,
} from "./contract.js";
import { type Acceptance, accept, findingId } from "./findings.js";
import { runnerHint } from "./results.js";
import { expandCommand } from "./runners.js";

export type Enforced = { blocked: boolean; report: string; notes: ReviewFinding[] };

const MESSAGES: Record<ContractKind, MessageKey> = {
  task: "contract.task",
  tasks: "contract.tasks",
  bae: "contract.bae",
  agents: "contract.agents",
  gitignore: "contract.gitignore",
  scripts: "contract.scripts",
  runner: "contract.runner",
  memory: "contract.memory",
  git: "contract.git",
  gitdir: "contract.gitdir",
  toolchain: "contract.toolchain",
  shadow: "contract.shadow",
};
const SCOPED = new Set<ContractKind>(["gitignore", "scripts", "runner"]);
const RUNNER_KEYS = ["jest", "mocha", "ava", "vitest"];

export async function enforceContract(
  ctx: CommandContext,
  capture: Capture,
  acceptance: Acceptance,
): Promise<Enforced> {
  const changes = await checkContract(ctx.cwd, {
    protected: capture.protected,
    shadows: capture.shadows,
    ignore: capture.ignore,
    taskPath: capture.path,
  });
  const flags = await newIndexFlags(ctx.cwd, capture);
  if (changes.length === 0 && flags.length === 0) return { blocked: false, report: "", notes: [] };
  const scope = scopePaths(capturedTask(capture));
  const findings = await Promise.all(
    changes.map(async (change) => {
      const listed = acceptable(change, scope);
      const finding = contractFinding(change);
      if (!listed || !SCOPED.has(change.kind)) {
        return settled(change, accept(acceptance, finding, listed));
      }
      const after = await readTextIfExists(join(ctx.cwd, ...change.path.split("/")));
      const weaker = weakening(change.kind, capture.protected[change.path] ?? "", after);
      if (!weaker) {
        return {
          ...finding,
          severity: "major" as const,
          message: `${finding.message} ${t("contract.scoped")}`,
        };
      }
      return settled(
        change,
        accept(acceptance, { ...finding, message: `${finding.message} ${weaker}` }, true),
      );
    }),
  );
  const restore = changes.filter((_, index) => findings[index]?.severity === "blocker");
  await restoreContract(ctx.cwd, restore);
  if (flags.length > 0) {
    await git(ctx.cwd, [
      "update-index",
      "--no-assume-unchanged",
      "--no-skip-worktree",
      "--",
      ...flags,
    ]);
    findings.push({
      severity: "blocker",
      id: findingId("contract", "index", flags.join(",")),
      message: t("contract.indexFlags", { files: flags.join(", ") }),
    });
  }
  const blocked = restore.length > 0 || flags.length > 0;
  const list = formatFindings(findings);
  if (blocked) ctx.prompter.warn(t("contract.failed"));
  ctx.prompter.note(list, t("contract.title"));
  return {
    blocked,
    report: `## ${t("contract.title")}\n\n${list}`,
    notes: findings.filter((finding) => finding.severity === "major"),
  };
}

function weakening(
  kind: ContractKind,
  before: string,
  after: string | undefined,
): string | undefined {
  if (kind === "gitignore") return undefined;
  const added = (text: string, previous: string) =>
    exclusionKeys(text).filter((key) => !exclusionKeys(previous).includes(key));
  if (kind === "runner") {
    const keys = added(after ?? "", before);
    return keys.length > 0 ? t("contract.weakerRunner", { keys: keys.join(", ") }) : undefined;
  }
  const old = parseObject(before) ?? {};
  const now = parseObject(after ?? "") ?? {};
  const scripts = asRecord(old.scripts);
  const current = asRecord(now.scripts);
  const dropped = Object.keys(scripts).flatMap((name) => {
    if (typeof scripts[name] !== "string") return [];
    if (typeof current[name] !== "string") return [`scripts.${name}`];
    const tools = (map: Record<string, unknown>) =>
      runnerHint(expandCommand(`npm run ${name}`, { scripts: map }));
    const lost = tools(scripts).filter((tool) => !tools(current).includes(tool));
    return lost.length > 0 ? [`scripts.${name} (${lost.join(", ")})`] : [];
  });
  const keys = RUNNER_KEYS.filter((key) => key in old).flatMap((key) =>
    added(JSON.stringify(now[key] ?? ""), JSON.stringify(old[key])),
  );
  if (dropped.length > 0) return t("contract.weakerScripts", { scripts: dropped.join(", ") });
  return keys.length > 0 ? t("contract.weakerRunner", { keys: keys.join(", ") }) : undefined;
}

async function newIndexFlags(cwd: string, capture: Capture): Promise<string[]> {
  if (!capture.git) return [];
  const flagged = (await flaggedFiles(cwd)) ?? [];
  const known = new Set(capture.flagged);
  return flagged.filter((path) => !known.has(path));
}

function contractFinding(change: ContractChange): ReviewFinding {
  return {
    severity: "blocker",
    id: findingId("contract", change.path, change.detail, change.fingerprint ?? ""),
    file: change.path,
    message: t(MESSAGES[change.kind], { path: change.path, detail: change.detail }),
  };
}

function settled(change: ContractChange, finding: ReviewFinding): ReviewFinding {
  const done =
    finding.severity !== "blocker"
      ? t("findings.accepted")
      : t(change.change === "created" ? "contract.removed" : "contract.restored");
  return { ...finding, message: `${finding.message} ${done}` };
}

function acceptable(change: ContractChange, scope: string[]): boolean {
  return isAcceptableKind(change.kind) && inScope(change.path, scope);
}
