import { isTestFile } from "../digest/baseline.js";
import { isLockfile, isSecretPath } from "../digest/files.js";
import { SECRET_TOKENS } from "../digest/redact.js";
import { t } from "../i18n/index.js";
import { sectionText, type Task } from "../tasks/schema.js";
import type { TaskChanges } from "./changes.js";
import type { ReviewFinding } from "./parse.js";

export type MechanicalReview = { passed: boolean; findings: ReviewFinding[] };

const OUT_MARKER = /^\W*(out|fuera)\b/i;
const CODE_SPAN = /`([^`\n]+)`/g;
const LIST_PATH =
  /^\s*[-*+]\s+([\w@.[\]()*?/-]+\/[\w@.[\]()*?/-]*|[\w@-]+\.[A-Za-z]\w*)(?=\s|$|[,;:])/;
const NEW_MARK = /\s*\((?:new|nuevo|nueva)\)$/i;
const ALWAYS_IN_SCOPE = new Set([".gitignore"]);

export function mechanicalReview(task: Task, changes: TaskChanges): MechanicalReview {
  const findings = [
    ...secretFindings(changes),
    ...testFindings(task, changes),
    ...scopeFindings(task, changes),
  ];
  return { passed: !findings.some((finding) => finding.severity === "blocker"), findings };
}

export function scopePaths(task: Task): string[] {
  const scope = sectionText(task.body, "scope") ?? "";
  const lines = scope.split(/\r?\n/);
  const out = lines.findIndex((line) => OUT_MARKER.test(line.replace(/[`*_]/g, "")));
  const inScope = out === -1 ? lines : lines.slice(0, out);
  const paths = inScope.flatMap((line) => [
    ...Array.from(line.matchAll(CODE_SPAN), (match) => match[1] ?? ""),
    LIST_PATH.exec(line)?.[1] ?? "",
  ]);
  return [...new Set(paths.map(normalize).filter((path): path is string => path !== undefined))];
}

export function inScope(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (/[*?]/.test(pattern)) return globToRegExp(pattern).test(file);
    const dir = pattern.endsWith("/") ? pattern : `${pattern}/`;
    return file === pattern.replace(/\/$/, "") || file.startsWith(dir);
  });
}

function secretFindings(changes: TaskChanges): ReviewFinding[] {
  const files = changes.files.filter(isSecretPath).map((file) => ({
    severity: "blocker" as const,
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
      { severity: "blocker" as const, file: path, message: t("mechanical.secretValue", { kind }) },
    ];
  });
  return [...files, ...values];
}

function testFindings(task: Task, changes: TaskChanges): ReviewFinding[] {
  if (task.meta.tests !== "required" || changes.files.some(isTestFile)) return [];
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

function normalize(raw: string): string | undefined {
  const path = raw.trim().replace(NEW_MARK, "").replace(/^\.\//, "");
  if (path === "" || /\s|:\/\//.test(path)) return undefined;
  return path.includes("/") || /\.[A-Za-z]\w*$/.test(path) ? path : undefined;
}

function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .split("**/")
    .map((part) =>
      part
        .split("**")
        .map((piece) =>
          piece
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, "[^/]*")
            .replace(/\?/g, "[^/]"),
        )
        .join(".*"),
    )
    .join("(?:.*/)?");
  return new RegExp(`^${source}$`);
}
