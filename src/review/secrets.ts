import { isTestFile } from "../digest/baseline.js";
import { isBinaryPath, isLockfile, isSecretPath } from "../digest/files.js";
import { SECRET_TOKENS } from "../digest/redact.js";
import { findingId } from "../gates/findings.js";
import { t } from "../i18n/index.js";
import type { AddedText, TaskChanges } from "./changes.js";
import type { ReviewFinding } from "./parse.js";
import { inScope } from "./scope.js";

export type SecretOptions = { allow: string[] };

const EXAMPLE_VALUES = new Set([
  "AKIAIOSFODNN7EXAMPLE",
  "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
]);
const TEST_PREFIXES = /^[spr]k_test_/;
const KEYWORD =
  "[A-Za-z0-9_.-]*(?:passw(?:or)?d|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)[A-Za-z0-9_.-]*";
const ASSIGNED = new RegExp(`${KEYWORD}["']?\\s*[:=]\\s*(["'])([^"'\\s]{8,})\\1`, "gi");
const CONNECTION = /\b[a-z][a-z0-9+.-]*:\/\/([^\s:@/'"]+):([^\s@/'"]+)@[^\s'"]+/gi;
const QUOTED_BLOB = /(["'`])([A-Za-z0-9+/_-]{40,}={0,2}|[a-f0-9]{48,})\1/g;
const LABEL = /^[\p{L}\s.,:;!?¿¡'-]+$/u;
const PLACEHOLDER =
  /^(?:\$|<|\{|%|\*+$)|^(?:x+|changeme|change[-_]me|example\w*|placeholder|password|pass|secret|dummy|fake|test\w*|your[-_]\w+|redacted)$/i;
const MIN_ENTROPY = 4.5;

export function secretFindings(changes: TaskChanges, options: SecretOptions): ReviewFinding[] {
  const allowed = (path: string) => options.allow.length > 0 && inScope(path, options.allow);
  const files = changes.files
    .filter((file) => isSecretPath(file) && !allowed(file))
    .map((file) => ({
      severity: "blocker" as const,
      id: findingId("secret", file),
      file,
      message: t("mechanical.secretFile"),
    }));
  const values = changes.added.flatMap((item) => {
    if (isSecretPath(item.path) || allowed(item.path)) return [];
    const kinds = secretKinds(item);
    if (kinds.length === 0) return [];
    const kind = kinds.join(", ");
    return [
      {
        severity: "blocker" as const,
        id: findingId("secret", item.path, kind),
        file: item.path,
        message: t("mechanical.secretValue", { kind }),
      },
    ];
  });
  return [...files, ...values];
}

export function secretKinds(item: AddedText): string[] {
  const kinds = SECRET_TOKENS.filter(([, pattern]) =>
    [...item.text.matchAll(new RegExp(pattern.source, "g"))].some((match) => !isExample(match[0])),
  ).map(([kind]) => kind);
  const loose = !isTestName(item.path) && !isLockfile(item.path) && !isBinaryPath(item.path);
  if (loose && hasAssignedSecret(item.text)) kinds.push("hardcoded password or key");
  if (hasCredentialUrl(item.text)) kinds.push("credentials in a connection string");
  if (loose && !/\.(svg|map|snap)$/i.test(item.path) && hasHighEntropyBlob(item.text)) {
    kinds.push("long random string");
  }
  return [...new Set(kinds)];
}

function isExample(value: string): boolean {
  return EXAMPLE_VALUES.has(value) || TEST_PREFIXES.test(value);
}

function hasAssignedSecret(text: string): boolean {
  return [...text.matchAll(ASSIGNED)].some((match) => {
    const value = match[2] ?? "";
    if (PLACEHOLDER.test(value) || EXAMPLE_VALUES.has(value) || LABEL.test(value)) return false;
    return !value.includes("/") && !/^[\w.-]+\.[a-z]{2,4}$/i.test(value);
  });
}

function isTestName(path: string): boolean {
  return (
    isTestFile(path) &&
    /(\.|_)(test|spec|cy|e2e)\.|(^|\/)test_[^/]+$|_test\.\w+$|Tests?\.\w+$/.test(path)
  );
}

function hasCredentialUrl(text: string): boolean {
  return [...text.matchAll(CONNECTION)].some((match) => {
    const password = match[2] ?? "";
    return !PLACEHOLDER.test(password) && !/^\$\{?\w+\}?$/.test(password);
  });
}

function hasHighEntropyBlob(text: string): boolean {
  return [...text.matchAll(QUOTED_BLOB)].some((match) => {
    const value = match[2] ?? "";
    const before = text.slice(Math.max(0, (match.index ?? 0) - 16), match.index ?? 0);
    if (/^sha\d+-/i.test(value) || /(data:[^,]*,|integrity["']?\s*[:=]\s*)$/i.test(before)) {
      return false;
    }
    return (
      /[A-Z]/.test(value) &&
      /[a-z]/.test(value) &&
      /\d/.test(value) &&
      entropy(value) >= MIN_ENTROPY
    );
  });
}

function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  return [...counts.values()].reduce((sum, count) => {
    const share = count / value.length;
    return sum - share * Math.log2(share);
  }, 0);
}
