import { isTestFile } from "../digest/baseline.js";
import { isLockfile, isSecretPath } from "../digest/files.js";
import { SECRET_TOKENS } from "../digest/redact.js";
import { type Acceptance, accept, findingId, newAcceptance } from "../gates/findings.js";
import { t } from "../i18n/index.js";
import type { Task } from "../tasks/schema.js";
import type { TaskChanges } from "./changes.js";
import { staticIntegrity } from "./integrity.js";
import type { ReviewFinding } from "./parse.js";
import { inScope, scopePaths } from "./scope.js";
import { addsAssertions } from "./tests.js";

export type MechanicalReview = { passed: boolean; findings: ReviewFinding[] };

const ALWAYS_IN_SCOPE = new Set([".gitignore"]);

export type MechanicalFacts = { testsGrew: boolean };

export function mechanicalReview(
  task: Task,
  changes: TaskChanges,
  acceptance: Acceptance = newAcceptance(),
  facts: MechanicalFacts = { testsGrew: false },
): MechanicalReview {
  const findings = [
    ...secretFindings(changes).map((finding) => accept(acceptance, finding, true)),
    ...staticIntegrity(task, changes, acceptance),
    ...testFindings(task, changes, facts),
    ...scopeFindings(task, changes),
  ];
  return { passed: !findings.some((finding) => finding.severity === "blocker"), findings };
}

function secretFindings(changes: TaskChanges): ReviewFinding[] {
  const files = changes.files.filter(isSecretPath).map((file) => ({
    severity: "blocker" as const,
    id: findingId("secret", file),
    file,
    message: t("mechanical.secretFile"),
  }));
  const values = changes.added.flatMap(({ path, text }) => {
    const kinds = SECRET_TOKENS.filter(([, pattern]) => text.search(pattern) !== -1).map(
      ([kind]) => kind,
    );
    if (kinds.length === 0 || isSecretPath(path)) return [];
    const kind = [...new Set(kinds)].join(", ");
    return [
      {
        severity: "blocker" as const,
        id: findingId("secret", path, kind),
        file: path,
        message: t("mechanical.secretValue", { kind }),
      },
    ];
  });
  return [...files, ...values];
}

function testFindings(task: Task, changes: TaskChanges, facts: MechanicalFacts): ReviewFinding[] {
  if (task.meta.tests !== "required" || facts.testsGrew || changes.added.some(addsAssertions)) {
    return [];
  }
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
