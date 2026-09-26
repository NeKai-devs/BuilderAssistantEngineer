import { isTestFile } from "../digest/baseline.js";
import { isLockfile } from "../digest/files.js";
import { type Acceptance, accept, newAcceptance } from "../gates/findings.js";
import { t } from "../i18n/index.js";
import type { Task } from "../tasks/schema.js";
import type { TaskChanges } from "./changes.js";
import { staticIntegrity } from "./integrity.js";
import type { ReviewFinding } from "./parse.js";
import { inScope, scopePaths } from "./scope.js";
import { type SecretOptions, secretFindings } from "./secrets.js";
import { addsAssertions, assertionCount } from "./tests.js";

export type MechanicalReview = { passed: boolean; findings: ReviewFinding[] };

const ALWAYS_IN_SCOPE = new Set([".gitignore"]);

export type MechanicalFacts = { testsGrew: boolean; secrets?: SecretOptions };

export function mechanicalReview(
  task: Task,
  changes: TaskChanges,
  acceptance: Acceptance = newAcceptance(),
  facts: MechanicalFacts = { testsGrew: false },
): MechanicalReview {
  const findings = [
    ...secretFindings(changes, facts.secrets ?? { allow: [] }).map((finding) =>
      accept(acceptance, finding, true),
    ),
    ...staticIntegrity(task, changes, acceptance),
    ...testFindings(task, changes, facts),
    ...scopeFindings(task, changes),
  ];
  return { passed: !findings.some((finding) => finding.severity === "blocker"), findings };
}

function testFindings(task: Task, changes: TaskChanges, facts: MechanicalFacts): ReviewFinding[] {
  if (task.meta.tests !== "required" || facts.testsGrew || addsNetAssertions(changes)) return [];
  return [{ severity: "blocker", message: t("mechanical.noTests") }];
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

function addsNetAssertions(changes: TaskChanges): boolean {
  const removed = new Map(changes.removed.map((item) => [item.path, assertionCount(item.text)]));
  return changes.added.some(
    (item) => addsAssertions(item) && assertionCount(item.text) > (removed.get(item.path) ?? 0),
  );
}
