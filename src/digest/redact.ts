const REDACTED = "[REDACTED]";

const TOKENS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

const KEYWORD =
  "[A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|credential)[A-Za-z0-9_.-]*";

const VALUES: [RegExp, string][] = [
  [new RegExp(`(${KEYWORD}["']?\\s*[:=]\\s*)(["'])[^"'\\s]{8,}\\2`, "gi"), `$1$2${REDACTED}$2`],
  [
    /^(\s*(?:export\s+)?[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIALS?)[A-Z0-9_]*\s*[=:]\s*)[^\s"'#]{8,}/gm,
    `$1${REDACTED}`,
  ],
  [/(_auth(?:Token)?\s*=\s*)\S+/g, `$1${REDACTED}`],
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, `$1${REDACTED}@`],
];

export function redact(text: string): string {
  const withoutTokens = TOKENS.reduce((result, pattern) => result.replace(pattern, REDACTED), text);
  return VALUES.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    withoutTokens,
  );
}
