import { isTestFile } from "../digest/baseline.js";
import { type Acceptance, accept, findingId } from "../gates/findings.js";
import type { SuiteCheck } from "../gates/regression.js";
import { type Counts, executed } from "../gates/results.js";
import { t } from "../i18n/index.js";
import type { Task } from "../tasks/schema.js";
import type { TaskChanges } from "./changes.js";
import type { ReviewFinding } from "./parse.js";
import { inScope, scopePaths } from "./scope.js";
import { exclusionKeys, isRunnerConfig, skipMarkers } from "./tests.js";

export function staticIntegrity(
  task: Task,
  changes: TaskChanges,
  acceptance: Acceptance,
): ReviewFinding[] {
  const scope = scopePaths(task);
  const texts = new Map(changes.added.map((item) => [item.path, item.text]));
  const findings = [
    ...changes.deleted
      .filter(isTestFile)
      .map((file) => blocker(file, t("integrity.deleted"), "deleted")),
    ...changes.added.flatMap((item) =>
      skipMarkers(item).map((marker) =>
        blocker(item.path, t("integrity.skipMarker", { marker }), marker),
      ),
    ),
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

function blocker(file: string, message: string, detail: string): ReviewFinding {
  return { severity: "blocker", id: findingId("integrity", file, detail), file, message };
}

function counted(check: SuiteCheck, kind: string, message: string): ReviewFinding {
  return { severity: "blocker", id: findingId("integrity", check.command, kind), message };
}

function describe(counts: Counts): string {
  return `${executed(counts)} run, ${counts.skipped} skipped`;
}
