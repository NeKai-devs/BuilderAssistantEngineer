import { isTestFile } from "../digest/baseline.js";
import { isLockfile, languageOf } from "../digest/files.js";
import { type Acceptance, accept, findingId } from "../gates/findings.js";
import type { SuiteCheck } from "../gates/regression.js";
import { type Counts, executed } from "../gates/results.js";
import { t } from "../i18n/index.js";
import type { Task } from "../tasks/schema.js";
import type { TaskChanges } from "./changes.js";
import type { ReviewFinding } from "./parse.js";
import { inScope, scopePaths } from "./scope.js";
import {
  annotatedCount,
  assertionCount,
  exclusionKeys,
  isExpectedOutput,
  isRunnerConfig,
  isTestChange,
  skipMarkers,
  suppressions,
  testNames,
} from "./tests.js";

export function staticIntegrity(
  task: Task,
  changes: TaskChanges,
  acceptance: Acceptance,
): ReviewFinding[] {
  const scope = scopePaths(task);
  const texts = new Map(changes.added.map((item) => [item.path, item.text]));
  const findings = [
    ...changes.deleted
      .filter((file) => isTestFile(file) && !movedElsewhere(file, changes))
      .map((file) => blocker(file, t("integrity.deleted"), "deleted")),
    ...changes.added.flatMap((item) =>
      skipMarkers(item).map((marker) =>
        blocker(item.path, t("integrity.skipMarker", { marker }), marker),
      ),
    ),
    ...removedTests(changes),
    ...lostAssertions(changes),
    ...changes.added.flatMap((item) => {
      const names = suppressions(item);
      if (names.length === 0 || isLockfile(item.path) || !languageOf(item.path)) return [];
      const what = names.join(", ");
      return [
        blocker(item.path, t("integrity.suppression", { markers: what }), `suppress:${what}`),
      ];
    }),
    ...changes.files
      .filter(isExpectedOutput)
      .map((file) => blocker(file, t("integrity.expectedOutput"), "expected-output")),
    ...changes.untracked.filter(isRunnerConfig).flatMap((path) => {
      const keys = exclusionKeys(texts.get(path) ?? "");
      if (keys.length === 0) return [];
      return [blocker(path, t("integrity.exclusion", { keys: keys.join(", ") }), keys.join(","))];
    }),
  ];
  return findings.map((finding) => accept(acceptance, finding, inScope(finding.file ?? "", scope)));
}

export function countIntegrity(checks: SuiteCheck[], acceptance: Acceptance): ReviewFinding[] {
  const findings = comparable(checks).flatMap(({ check, now, before }) => {
    const vars = { command: check.command, now: describe(now), before: describe(before) };
    return [
      ...(executed(now) < executed(before)
        ? [counted(check, "fewer", t("integrity.fewerTests", vars))]
        : []),
      ...(now.skipped > before.skipped
        ? [counted(check, "skipped", t("integrity.moreSkipped", vars))]
        : []),
    ];
  });
  return findings.map((finding) => accept(acceptance, finding, true));
}

export function testsGrew(checks: SuiteCheck[]): boolean {
  return comparable(checks).some(({ now, before }) => executed(now) > executed(before));
}

function comparable(checks: SuiteCheck[]) {
  return checks.flatMap((check) =>
    check.key === "test" && check.counts && check.before?.counts
      ? [{ check, now: check.counts, before: check.before.counts }]
      : [],
  );
}

function movedElsewhere(file: string, changes: TaskChanges): boolean {
  const removed = changes.removed.find((item) => item.path === file);
  const names = testNames(removed?.text ?? "");
  if (names.length === 0) return false;
  const kept = new Set(changes.added.filter(isTestChange).flatMap((item) => testNames(item.text)));
  return names.every((name) => kept.has(name));
}

function removedTests(changes: TaskChanges): ReviewFinding[] {
  const kept = new Set(changes.added.filter(isTestChange).flatMap((item) => testNames(item.text)));
  const added = new Map(changes.added.map((item) => [item.path, annotatedCount(item.text)]));
  return changes.removed
    .filter((item) => isTestChange(item) || isTestFile(item.path))
    .flatMap((item) => {
      const names = [...new Set(testNames(item.text))].filter((name) => !kept.has(name));
      const annotated = annotatedCount(item.text) - (added.get(item.path) ?? 0);
      if (names.length === 0 && annotated <= 0) return [];
      const what = names.length > 0 ? names.join(", ") : String(annotated);
      return [blocker(item.path, t("integrity.removedTests", { tests: what }), `removed:${what}`)];
    });
}

function lostAssertions(changes: TaskChanges): ReviewFinding[] {
  const added = new Map(changes.added.map((item) => [item.path, assertionCount(item.text)]));
  return changes.removed
    .filter((item) => isTestFile(item.path) && !changes.deleted.includes(item.path))
    .flatMap((item) => {
      const lost = assertionCount(item.text) - (added.get(item.path) ?? 0);
      if (lost <= 0) return [];
      return [
        blocker(item.path, t("integrity.lostAssertions", { count: lost }), `assertions:${lost}`),
      ];
    });
}

function blocker(file: string, message: string, detail: string): ReviewFinding {
  return { severity: "blocker", id: findingId("integrity", file, detail), file, message };
}

function counted(check: SuiteCheck, kind: string, message: string): ReviewFinding {
  return { severity: "blocker", id: findingId("integrity", check.command, kind), message };
}

function describe(counts: Counts): string {
  return `${executed(counts)} run, ${counts.skipped} skipped`;
}
