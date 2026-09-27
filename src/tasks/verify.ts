import { runScript } from "../core/bash.js";
import type { ShellResult } from "../core/process.js";
import { t } from "../i18n/index.js";
import { trivialityProblems } from "./checks.js";
import {
  heredocEnd,
  logicalLines,
  openQuote,
  parseLine,
  program,
  unquoted,
} from "./shell-words.js";

export type Unsafe = { command: string; reason: string };
export type VerificationRun = {
  passed: boolean;
  exitCode: number;
  output: string;
  script: string;
  tolerated: string[];
  failed?: string;
};

const HEADER = [
  "set -Eeuo pipefail",
  "export CI=true",
  `trap 'bae_status=$?; printf "\\nbae: failed with exit %s: %s\\n" "$bae_status" "$BASH_COMMAND" >&2' ERR`,
  `bae_reuse() { printf '$ %s (%s)\\n' "$2" "$3"; return "$1"; }`,
  `bae_ok() { [ "$1" -eq 0 ] || { printf '\\nbae: failed with exit %s: %s\\n' "$1" "$2" >&2; exit "$1"; }; }`,
];
const FAILED_LINE = /^bae: failed with exit \d+: (.*)$/gm;
const OPENERS = /(^|[;&|]\s*)(if|while|until|for|case|select)\b/g;
const CLOSERS = /(^|[;&|]\s*)(fi|done|esac)\b/g;
const STATEFUL = new Set([
  "cd",
  "pushd",
  "popd",
  "export",
  "unset",
  "set",
  "source",
  ".",
  "alias",
  "shopt",
  "umask",
  "trap",
  "declare",
  "typeset",
  "local",
  "readonly",
  "eval",
  "exec",
  "function",
]);

type Planned = { text: string; check?: string; reusable: boolean };

const RULES: [string, (command: string) => boolean][] = [
  ["sudo", (command) => /(^|[\s;&|(`$])(sudo|doas)(\s|$)/.test(command)],
  ["rm -rf", hasRecursiveForceRm],
  [
    "curl | sh",
    (command) =>
      /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh|dash|ksh|fish|python[\d.]*|node|perl|ruby|iex|invoke-expression)\b/i.test(
        command,
      ),
  ],
  ["git reset --hard", (command) => /\bgit\s+reset\b[^;&|]*--hard/.test(command)],
  ["git clean -f", (command) => /\bgit\s+clean\b[^;&|]*\s-[a-zA-Z]*f/.test(command)],
  ["git push", (command) => /\bgit\s+push\b/.test(command)],
  [
    "publish",
    (command) => /\b(npm|pnpm|yarn)\s+(npm\s+)?publish\b|\bdocker\s+push\b/.test(command),
  ],
  [
    "disk tools",
    (command) => /\b(mkfs(\.\w+)?|fdisk|diskpart)\b|\bdd\b[^;&|]*\bof=\/dev\//.test(command),
  ],
  ["shutdown", (command) => /\b(shutdown|reboot|halt|poweroff)\b/.test(command)],
  ["fork bomb", (command) => /:\(\)\s*\{/.test(command)],
  [
    "recursive delete",
    (command) =>
      /\b(rd|rmdir)\s+\/s\b|\bdel\b[^;&|]*\/s\b|remove-item\b(?=[^;&|]*-recurse)(?=[^;&|]*-force)/i.test(
        command,
      ),
  ],
];

export function findUnsafe(commands: string[]): Unsafe[] {
  return commands.flatMap((command) => {
    const rule = RULES.find(([, matches]) => matches(command));
    return rule ? [{ command, reason: rule[0] }] : [];
  });
}

export async function runVerification(
  cwd: string,
  lines: string[],
  options: {
    bash: string;
    onOutput?: (chunk: string) => void;
    known?: ReadonlyMap<string, ShellResult>;
    excused?: ReadonlySet<string>;
    timeoutMs?: number;
  },
): Promise<VerificationRun> {
  const known = options.known ?? new Map<string, ShellResult>();
  const excused = options.excused ?? new Set<string>();
  const commands = logicalLines(lines);
  const tolerated = commands.filter(
    (command) => excused.has(command) && (known.get(command)?.exitCode ?? 0) !== 0,
  );
  const script = lines.join("\n");
  const counted = commands.filter((command) => !(excused.has(command) && known.has(command)));
  const onlyExcused =
    counted.length < commands.length &&
    (counted.length === 0 || trivialityProblems(counted).some((item) => item.reason === "trivial"));
  if (onlyExcused) {
    return {
      passed: false,
      exitCode: 1,
      output: t("verify.onlyExcused"),
      script,
      tolerated,
      ...(commands[0] ? { failed: commands[0] } : {}),
    };
  }
  const body = planLines(lines).flatMap((line) => {
    const command = line.text.trim();
    const result = line.reusable && line.check === command ? known.get(command) : undefined;
    const check = line.check === undefined ? [] : [`bae_ok $? ${quote(line.check)}`];
    if (!result) return [line.text, ...check];
    const allowed = excused.has(command);
    const code = allowed ? 0 : result.exitCode;
    const note = allowed
      ? `exit ${result.exitCode}, preexisting: it already failed before the task and did not get worse`
      : `exit ${result.exitCode}, from the regression check`;
    return [`bae_reuse ${code} ${quote(command)} ${quote(note)}`, ...check];
  });
  options.onOutput?.(`${lines.map((line) => `$ ${line}`).join("\n")}\n`);
  const result = await runScript(options.bash, [...HEADER, ...body, ""].join("\n"), {
    cwd,
    onOutput: options.onOutput,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  const failed = [...result.output.matchAll(FAILED_LINE)].at(-1)?.[1];
  return {
    passed: result.exitCode === 0,
    exitCode: result.exitCode,
    output: result.output,
    script,
    tolerated,
    ...(failed ? { failed } : {}),
  };
}

function planLines(lines: string[]): Planned[] {
  const planned: Planned[] = [];
  let depth = 0;
  let heredoc: string | undefined;
  let quote: "'" | '"' | undefined;
  let pending = "";
  let stateful = false;
  for (const line of lines) {
    const entry: Planned = { text: line, reusable: false };
    planned.push(entry);
    if (heredoc !== undefined) {
      if (line.replace(/^\t+/, "").trimEnd() === heredoc) heredoc = undefined;
      continue;
    }
    const trimmed = line.trim();
    const inside = quote !== undefined;
    if (!inside && pending === "" && (trimmed === "" || trimmed.startsWith("#"))) continue;
    entry.reusable = !inside && pending === "" && depth === 0 && !stateful;
    pending = pending ? `${pending}${inside ? "\n" : " "}${trimmed}` : trimmed;
    quote = openQuote(line, quote);
    if (quote) continue;
    if (!inside) {
      depth += blockDelta(trimmed);
      heredoc = heredocEnd(trimmed);
      stateful ||= changesState(trimmed);
    }
    if (/(\\|&&|\|\||\|)$/.test(unquoted(trimmed).trimEnd()) || heredoc || depth > 0) continue;
    depth = Math.max(depth, 0);
    entry.check = pending;
    pending = "";
  }
  return planned;
}

function changesState(line: string): boolean {
  return parseLine(line).commands.some((command) => {
    const { name } = program(command);
    return (
      STATEFUL.has(name) ||
      /^[A-Za-z_]\w*\s*\(\s*\)/.test(command.text) ||
      (command.words.length > 0 && command.words.every((word) => /^[A-Za-z_]\w*=/.test(word)))
    );
  });
}

function blockDelta(line: string): number {
  const code = unquoted(line);
  const opens = [...code.matchAll(OPENERS)].length + (/\{\s*$/.test(code) ? 1 : 0);
  const closes = [...code.matchAll(CLOSERS)].length + (/^\s*\}/.test(code) ? 1 : 0);
  return opens - closes;
}

function quote(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function hasRecursiveForceRm(command: string): boolean {
  return command.split(/[;&|]+/).some((segment) => {
    const tokens = segment.trim().split(/\s+/);
    const index = tokens.findIndex((token) => token === "rm" || token.endsWith("/rm"));
    if (index === -1) return false;
    const flags = tokens.slice(index + 1).filter((token) => token.startsWith("-"));
    const short = flags.filter((flag) => /^-[a-zA-Z]+$/.test(flag)).join("");
    const recursive = /[rR]/.test(short) || flags.includes("--recursive");
    const force = short.includes("f") || flags.includes("--force");
    return recursive && force;
  });
}
