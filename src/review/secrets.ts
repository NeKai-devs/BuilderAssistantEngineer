import { isTestFile } from "../digest/baseline.js";
import { isBinaryPath, isLockfile, isSecretPath } from "../digest/files.js";
import { SECRET_TOKENS } from "../digest/redact.js";
import { findingId } from "../gates/findings.js";
import { type MessageKey, t } from "../i18n/index.js";
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
  "(?<![A-Za-z0-9_.-])[A-Za-z0-9_.-]{0,40}(?:passw(?:or)?d|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)[A-Za-z0-9_.-]{0,40}";
const ASSIGNED = new RegExp(`${KEYWORD}["']?[ \\t]*[:=][ \\t]*(["'])([^"'\\s]{8,})\\1`, "gi");
const UNQUOTED = new RegExp(
  `^[ \\t]*(?:export[ \\t]+)?${KEYWORD}[ \\t]*[:=][ \\t]*()([^\\s"'#,;]{8,})[ \\t]*(?:#.*)?$`,
  "gim",
);
const SECRET_CONTEXT = new RegExp(`${KEYWORD}["']?[ \\t]*[:=]`, "i");
const PUBLIC_CONTEXT =
  /public|pub[_-]?key|vapid|checksum|sha\d*|digest|hash|integrity|fingerprint|etag|commit|revision|nonce|uuid|id["']?\s*[:=]\s*$/i;
const LOCAL_HOSTS =
  /@(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|db|database|postgres|mysql|redis|mongo|host\.docker\.internal|example\.(?:com|org|net))(?:[:/]|$)/i;
const SAMPLE_JWT = "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const IDENTIFIER = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$|^[a-z]{1,15}(_[a-z]{1,15})+$|^\d+$/;
const CONNECTION = /\b[a-z][a-z0-9+.-]*:\/\/([^\s:@/'"]+):([^\s@/'"]+)@[^\s'"]+/gi;
const QUOTED_BLOB = /(["'`])([A-Za-z0-9+/_-]{40,}={0,2}|[a-f0-9]{48,})\1/g;
const LABEL = /^[\p{L}\s.,:;!?¿¡'-]+$/u;
const PLACEHOLDER =
  /^(?:\$|<|\{|%|\*+$)|^(?:x+|changeme|change[-_]me|example\w*|placeholder|password\d*|pass\d*|secret\d*|dummy|fake|test\w*|your[-_]\w+|my\w*|redacted|postgres|root|admin|dev|local|mysql|guest|user|sa|app)$/i;
const MIN_ENTROPY = 4.5;

export function secretFindings(
  changes: TaskChanges,
  options: SecretOptions,
  history: AddedText[] = [],
): ReviewFinding[] {
  const allowed = (path: string) => options.allow.length > 0 && inScope(path, options.allow);
  const deleted = new Set(changes.deleted);
  const fileFinding = (file: string, key: MessageKey): ReviewFinding => ({
    severity: "blocker",
    id: findingId("secret", file),
    file,
    message: t(key),
  });
  const valueFindings = (items: AddedText[], key: MessageKey) =>
    items.flatMap((item): ReviewFinding[] => {
      if (secretFile(item.path) || allowed(item.path)) return [];
      const kinds = secretKinds(item);
      if (kinds.length === 0) return [];
      const kind = kinds.join(", ");
      return [
        {
          severity: "blocker",
          id: findingId("secret", item.path, kind),
          file: item.path,
          message: t(key, { kind }),
        },
      ];
    });
  const found = [
    ...changes.files
      .filter((file) => secretFile(file) && !allowed(file) && !deleted.has(file))
      .map((file) => fileFinding(file, "mechanical.secretFile")),
    ...valueFindings(changes.added, "mechanical.secretValue"),
    ...[...new Set(history.map((item) => item.path))]
      .filter((file) => secretFile(file) && !allowed(file))
      .map((file) => fileFinding(file, "mechanical.secretFileHistory")),
    ...valueFindings(history, "mechanical.secretHistory"),
  ];
  const seen = new Set<string>();
  return found.filter((finding) => {
    if (seen.has(finding.id ?? "")) return false;
    seen.add(finding.id ?? "");
    return true;
  });
}

export function secretFile(path: string): boolean {
  if (/\.(pem|crt|cer|tfvars)$/i.test(path)) return false;
  if (/(^|\/)\.env\.(development|dev|test|ci|defaults)$/i.test(path)) return false;
  return isSecretPath(path);
}

export function secretKinds(item: AddedText): string[] {
  const kinds = SECRET_TOKENS.filter(([, pattern]) =>
    [...item.text.matchAll(new RegExp(pattern.source, "g"))].some((match) => !isExample(match[0])),
  ).map(([kind]) => kind);
  if (item.path.startsWith("(commit ")) return [...new Set(kinds)];
  const loose =
    !isTestName(item.path) &&
    !isFixture(item.path) &&
    !isLockfile(item.path) &&
    !isBinaryPath(item.path);
  if (loose && hasAssignedSecret(item.text)) kinds.push("hardcoded password or key");
  if (hasCredentialUrl(item.text)) kinds.push("credentials in a connection string");
  if (loose && !/\.(svg|map|snap)$/i.test(item.path) && hasHighEntropyBlob(item.text)) {
    kinds.push("long random string");
  }
  return [...new Set(kinds)];
}

function isExample(value: string): boolean {
  if (EXAMPLE_VALUES.has(value) || TEST_PREFIXES.test(value) || value.endsWith(SAMPLE_JWT)) {
    return true;
  }
  const body = value.replace(
    /^(?:AKIA|ASIA|gh[pousr]_|github_pat_|glpat-|xox[abprs]-|sk-|[rs]k_live_|AIza|npm_)/,
    "",
  );
  if (
    /example|sample|fake|dummy|placeholder|test|your|redacted|changeme|xxxx|0000/i.test(
      body,
    )
  ) {
    return true;
  }
  return new Set(body).size <= 6 || /(.)\1{5,}/.test(body);
}

function isFixture(path: string): boolean {
  return (
    /(^|\/)(fixtures?|__fixtures__|testdata|mocks?|__mocks__)\//.test(path) ||
    /\.(md|mdx|rst|txt)$/i.test(path)
  );
}

function looksPublic(value: string): boolean {
  return (
    /^arn:/.test(value) ||
    /^\^|\(\?[=!:<]|\.\{\d|\\[dws]|\[[A-Za-z]-[A-Za-z]\]/.test(value) ||
    !/[A-Za-z0-9]/.test(value)
  );
}

function hasAssignedSecret(text: string): boolean {
  return [...text.matchAll(ASSIGNED), ...text.matchAll(UNQUOTED)].some((match) => {
    const value = match[2] ?? "";
    if (PLACEHOLDER.test(value) || EXAMPLE_VALUES.has(value) || LABEL.test(value)) return false;
    if (looksPublic(value) || isExample(value)) return false;
    if (IDENTIFIER.test(value) || /^[$<{%]/.test(value)) return false;
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
    if (LOCAL_HOSTS.test(match[0].slice(match[0].indexOf("@")))) return false;
    return !PLACEHOLDER.test(password) && !/^\$\{?\w+\}?$/.test(password);
  });
}

function hasHighEntropyBlob(text: string): boolean {
  return [...text.matchAll(QUOTED_BLOB)].some((match) => {
    const value = match[2] ?? "";
    const before = text.slice(Math.max(0, (match.index ?? 0) - 16), match.index ?? 0);
    const context = text.slice(Math.max(0, (match.index ?? 0) - 60), match.index ?? 0);
    const line = context.split("\n").at(-1) ?? "";
    if (/^sha\d+-/i.test(value) || /(data:[^,]*,|integrity["']?\s*[:=]\s*)$/i.test(before)) {
      return false;
    }
    if (PUBLIC_CONTEXT.test(line) && !SECRET_CONTEXT.test(line)) return false;
    if (/^[a-f0-9]+$/.test(value)) {
      return SECRET_CONTEXT.test(line) && value.length >= 32 && entropy(value) >= 3.5;
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
