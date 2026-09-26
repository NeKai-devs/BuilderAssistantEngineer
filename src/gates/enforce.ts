import type { CommandContext } from "../commands/context.js";
import { type MessageKey, t } from "../i18n/index.js";
import type { ReviewFinding } from "../review/parse.js";
import { capturedTask, formatFindings } from "../review/run.js";
import { inScope, scopePaths } from "../review/scope.js";
import type { Capture } from "./capture.js";
import {
  type ContractChange,
  type ContractKind,
  checkContract,
  isAcceptableKind,
  restoreContract,
} from "./contract.js";
import { type Acceptance, accept, findingId } from "./findings.js";

export type Enforced = { blocked: boolean; report: string };

const MESSAGES: Record<ContractKind, MessageKey> = {
  task: "contract.task",
  tasks: "contract.tasks",
  bae: "contract.bae",
  agents: "contract.agents",
  gitignore: "contract.gitignore",
  scripts: "contract.scripts",
  runner: "contract.runner",
};

export async function enforceContract(
  ctx: CommandContext,
  capture: Capture,
  acceptance: Acceptance,
): Promise<Enforced> {
  const changes = await checkContract(ctx.cwd, capture.protected, capture.path);
  if (changes.length === 0) return { blocked: false, report: "" };
  const scope = scopePaths(capturedTask(capture));
  const findings = changes.map((change) =>
    settled(change, accept(acceptance, contractFinding(change), acceptable(change, scope))),
  );
  const restore = changes.filter((_, index) => findings[index]?.severity === "blocker");
  await restoreContract(ctx.cwd, restore);
  const blocked = restore.length > 0;
  const list = formatFindings(findings);
  if (blocked) ctx.prompter.warn(t("contract.failed"));
  ctx.prompter.note(list, t("contract.title"));
  return { blocked, report: `## ${t("contract.title")}\n\n${list}` };
}

function contractFinding(change: ContractChange): ReviewFinding {
  return {
    severity: "blocker",
    id: findingId("contract", change.path, change.detail),
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
  return (
    change.change !== "created" && isAcceptableKind(change.kind) && inScope(change.path, scope)
  );
}
