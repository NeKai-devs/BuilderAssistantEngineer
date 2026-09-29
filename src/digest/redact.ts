const REDACTED = "[REDACTED]";

export const SECRET_TOKENS: [string, RegExp][] = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  [
    "private key",
    /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g,
  ],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["Slack webhook", /https:\/\/hooks\.slack\.com\/services\/T\w+\/B\w+\/\w+/g],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ["GitHub token", /\bgithub_pat_[A-Za-z0-9_]{22,}/g],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["API key", /\bsk-[A-Za-z0-9_-]{20,}/g],
  ["Stripe key", /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}/g],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/g],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}/g],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
];

const TOKENS = [
  ...SECRET_TOKENS.map(([, pattern]) => pattern),
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
  /\bSK[0-9A-Za-z]{32,40}\b/g,
  /\bwhsec_[A-Za-z0-9+/=]{20,}/g,
  /\bhv[sbr]\.[A-Za-z0-9_-]{20,}/g,
];

const SECRET_WORD =
  "(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|credential|private[_-]?key|access[_-]?key|client[_-]?key|account[_-]?key)";
const KEYWORD = `[A-Za-z0-9_.-]*${SECRET_WORD}[A-Za-z0-9_.-]*`;
const ENV_KEY = "[A-Z0-9_]*KEY[A-Z0-9_]*";
const ASSIGN = `^(\\s*(?:-\\s+)?(?:(?:export|ENV|ARG|set)\\s+)?NAME\\s*(?:\\?=|:=|\\+=|=|:)\\s*)[^\\s"'#]{8,}`;
const HAS_DIGIT = "(?=[^\\s\"'<>]*\\d)";

const VALUES: [RegExp, string][] = [
  [new RegExp(`(${KEYWORD}["']?\\s*[:=]\\s*)(["'])[^"'\\s]{8,}\\2`, "gi"), `$1$2${REDACTED}$2`],
  [new RegExp(ASSIGN.replace("NAME", KEYWORD), "gim"), `$1${REDACTED}`],
  [new RegExp(ASSIGN.replace("NAME", ENV_KEY), "gm"), `$1${REDACTED}`],
  [/(_auth(?:Token)?\s*=\s*)\S+/g, `$1${REDACTED}`],
  [
    new RegExp(`(\\b${KEYWORD}\\s*[:=]\\s*)${HAS_DIGIT}[A-Za-z0-9+/=_.-]{16,}`, "gi"),
    `$1${REDACTED}`,
  ],
  [new RegExp(`((?:^|[?&;\\s"'])${KEYWORD}=)[^&;"'\\s<>]{4,}`, "gi"), `$1${REDACTED}`],
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]*:[^\s@/]+@/gi, `$1${REDACTED}@`],
  [
    new RegExp(`(\\b(?:Bearer|Basic|Token)\\s+)${HAS_DIGIT}[A-Za-z0-9._~+/-]{12,}=*`, "g"),
    `$1${REDACTED}`,
  ],
  [new RegExp(`(<(\\w*${SECRET_WORD}\\w*)>)[^<]{4,}(</\\2>)`, "gi"), `$1${REDACTED}$3`],
  [
    new RegExp(
      `(\\b(?:passw(?:or)?d|pwd|token|secret|api key)\\s+(?:is|to|=|:)\\s+)${HAS_DIGIT}\\S{6,}`,
      "gi",
    ),
    `$1${REDACTED}`,
  ],
];

export function redact(text: string): string {
  const withoutTokens = TOKENS.reduce((result, pattern) => result.replace(pattern, REDACTED), text);
  return VALUES.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    withoutTokens,
  );
}
