import { isTestFile } from "../digest/baseline.js";
import { isBuildOutput, isLockfile } from "../digest/files.js";
import { type Acceptance, accept, findingId, newAcceptance } from "../gates/findings.js";
import { t } from "../i18n/index.js";
import type { Task } from "../tasks/schema.js";
import type { AddedText, TaskChanges } from "./changes.js";
import { staticIntegrity } from "./integrity.js";
import type { ReviewFinding } from "./parse.js";
import { inScope, scopePaths } from "./scope.js";
import { type SecretOptions, secretFindings } from "./secrets.js";
import { assertionCount, isTestChange } from "./tests.js";

export type MechanicalReview = { passed: boolean; findings: ReviewFinding[] };

const ALWAYS_IN_SCOPE = new Set([".gitignore"]);

export type MechanicalFacts = {
  testsGrew: boolean;
  counted?: boolean;
  secrets?: SecretOptions;
  history?: AddedText[];
};

export function mechanicalReview(
  task: Task,
  changes: TaskChanges,
  acceptance: Acceptance = newAcceptance(),
  facts: MechanicalFacts = { testsGrew: false },
): MechanicalReview {
  const own = sourceChanges(changes);
  const findings = [
    ...secretFindings(changes, facts.secrets ?? { allow: [] }, facts.history).map((finding) =>
      accept(acceptance, finding, true),
    ),
    ...staticIntegrity(task, own, acceptance),
    ...testFindings(task, own, facts).map((finding) => accept(acceptance, finding, true)),
    ...scopeFindings(task, own),
  ];
  return { passed: !findings.some((finding) => finding.severity === "blocker"), findings };
}

function sourceChanges(changes: TaskChanges): TaskChanges {
  const keep = (path: string) => !isBuildOutput(path);
  return {
    files: changes.files.filter(keep),
    added: changes.added.filter((item) => keep(item.path)),
    removed: changes.removed.filter((item) => keep(item.path)),
    deleted: changes.deleted.filter(keep),
    untracked: changes.untracked.filter(keep),
  };
}

function testFindings(task: Task, changes: TaskChanges, facts: MechanicalFacts): ReviewFinding[] {
  if (task.meta.tests !== "required" || facts.testsGrew) return [];
  if (netAssertions(changes, facts.counted ?? false) > 0) return [];
  return [
    {
      severity: "blocker",
      id: findingId("integrity", task.path, "tests-required"),
      message: t("mechanical.noTests"),
    },
  ];
}

function scopeFindings(task: Task, changes: TaskChanges): ReviewFinding[] {
  const patterns = scopePaths(task);
  if (patterns.length === 0) return [];
  const outside = changes.files.filter(
    (file) =>
      !inScope(file, patterns) &&
      !isTestFile(file) &&
      !isLockfile(file) &&
      !ALWAYS_IN_SCOPE.has(file),
  );
  if (outside.length === 0) return [];
  return [
    { severity: "major", message: t("mechanical.outOfScope", { files: outside.join(", ") }) },
  ];
}

function netAssertions(changes: TaskChanges, counted: boolean): number {
  const fresh = new Set(changes.untracked);
  const total = (items: AddedText[]) =>
    items.filter(isTestChange).reduce((sum, item) => sum + assertionCount(item.text), 0);
  const added = changes.added.filter((item) => !(counted && fresh.has(item.path)));
  return total(added) - total(changes.removed);
}
