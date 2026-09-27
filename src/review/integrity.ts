import { isTestFile } from "../digest/baseline.js";
import { isLockfile, languageOf } from "../digest/files.js";
import { type Acceptance, accept, findingId } from "../gates/findings.js";
import type { SuiteCheck } from "../gates/regression.js";
import { type Counts, executed } from "../gates/results.js";
import { t } from "../i18n/index.js";
import type { Task } from "../tasks/schema.js";
import type { AddedText, TaskChanges } from "./changes.js";
import type { ReviewFinding } from "./parse.js";
import { inScope, scopePaths } from "./scope.js";
import {
  annotatedCount,
  assertionCount,
  EXPECTED_FAILURES,
  exclusionKeys,
  isExpectedOutput,
  isRunnerConfig,
  isTestChange,
  markerCounts,
  suppressionLines,
  testNames,
} from "./tests.js";

export function staticIntegrity(
  task: Task,
  changes: TaskChanges,
  acceptance: Acceptance,
): ReviewFinding[] {
  const scope = scopePaths(task);
  const listed = (file: string) => inScope(file, scope);
  const texts = new Map(changes.added.map((item) => [item.path, item.text]));
  const before = new Map(changes.removed.map((item) => [item.path, item.text]));
  const findings = [
    ...changes.deleted
      .filter((file) => isTestFile(file) && !movedElsewhere(file, changes))
      .map((file) => scoped(listed(file), blocker(file, t("integrity.deleted"), "deleted"))),
    ...changes.added.filter(isTestChange).flatMap((item) =>
      addedMarkers(item.text, before.get(item.path) ?? "").map((marker) => {
        const finding = blocker(item.path, t("integrity.skipMarker", { marker }), marker);
        return EXPECTED_FAILURES.has(marker) ? finding : scoped(listed(item.path), finding);
      }),
    ),
    ...removedTests(changes).map((finding) => scoped(listed(finding.file ?? ""), finding)),
    ...lostAssertions(changes, listed),
    ...changes.added.flatMap((item) => suppressionFindings(item, before.get(item.path) ?? "")),
    ...changes.files.filter(isExpectedOutput).map((file) => {
      const finding = blocker(file, t("integrity.expectedOutput"), "expected-output");
      return scoped(listed(file) || changes.untracked.includes(file), finding);
    }),
    ...changes.untracked.filter(isRunnerConfig).flatMap((path) => {
      const keys = exclusionKeys(texts.get(path) ?? "");
      if (keys.length === 0) return [];
      return [blocker(path, t("integrity.exclusion", { keys: keys.join(", ") }), keys.join(","))];
    }),
  ];
  return findings.map((finding) =>
    finding.severity === "blocker"
      ? accept(acceptance, finding, listed(finding.file ?? ""))
      : finding,
  );
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

function lostAssertions(changes: TaskChanges, listed: (file: string) => boolean): ReviewFinding[] {
  const tally = (items: AddedText[]) =>
    new Map(items.filter(isTestChange).map((item) => [item.path, assertionCount(item.text)]));
  const removed = tally(changes.removed);
  const added = tally(changes.added);
  const sum = (counts: Map<string, number>) => [...counts.values()].reduce((a, b) => a + b, 0);
  if (sum(added) >= sum(removed)) return [];
  const losing = [...removed.entries()].filter(
    ([path, count]) => count > (added.get(path) ?? 0) && !changes.deleted.includes(path),
  );
  const authorized = losing.every(([path]) => listed(path));
  return losing.map(([path, count]) => {
    const lost = count - (added.get(path) ?? 0);
    const finding = blocker(
      path,
      t("integrity.lostAssertions", { count: lost }),
      `assertions:${lost}`,
    );
    return scoped(authorized, finding);
  });
}

function addedMarkers(added: string, removed: string): string[] {
  const now = markerCounts(added);
  const then = markerCounts(removed);
  return [...now.entries()]
    .filter(([name, count]) => count > (then.get(name) ?? 0))
    .map(([name]) => name);
}

function suppressionFindings(item: AddedText, removed: string): ReviewFinding[] {
  if (isLockfile(item.path) || !languageOf(item.path)) return [];
  const net = (specific: boolean) => {
    const count = (text: string) =>
      suppressionLines(text).filter((line) => line.specific === specific);
    const names = count(item.text).map((line) => line.name);
    const gone = count(removed).map((line) => line.name);
    return names.length > gone.length ? [...new Set(names)] : [];
  };
  const blanket = net(false);
  const specific = net(true);
  const found = (names: string[]) =>
    blocker(
      item.path,
      t("integrity.suppression", { markers: names.join(", ") }),
      `suppress:${names.join(", ")}`,
    );
  return [
    ...(blanket.length > 0 ? [found(blanket)] : []),
    ...(specific.length > 0 ? [{ ...found(specific), severity: "major" as const }] : []),
  ];
}

function scoped(authorized: boolean, finding: ReviewFinding): ReviewFinding {
  if (!authorized) return finding;
  return { ...finding, severity: "major", message: `${finding.message} ${t("integrity.scoped")}` };
}

export function hasComparableCounts(checks: SuiteCheck[]): boolean {
  return comparable(checks).length > 0;
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
