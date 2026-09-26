import { runScript } from "../core/bash.js";
import type { ShellResult } from "../core/process.js";
import { t } from "../i18n/index.js";
import { logicalLines } from "./shell-words.js";

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
  `trap 'bae_status=$?; printf "\\nbae: line %s failed with exit %s: %s\\n" "$((LINENO - 3))" "$bae_status" "$BASH_COMMAND" >&2' ERR`,
  `bae_reuse() { printf '$ %s (%s)\\n' "$2" "$3"; return "$1"; }`,
];
const FAILED_LINE = /^bae: line \d+ failed with exit \d+: (.*)$/gm;

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
  },
): Promise<VerificationRun> {
  const known = options.known ?? new Map<string, ShellResult>();
  const excused = options.excused ?? new Set<string>();
  const commands = logicalLines(lines);
  const tolerated = commands.filter(
    (command) => excused.has(command) && (known.get(command)?.exitCode ?? 0) !== 0,
  );
  const script = lines.join("\n");
  if (commands.length > 0 && commands.every((command) => excused.has(command))) {
    return {
      passed: false,
      exitCode: 1,
      output: t("verify.onlyExcused"),
      script,
      tolerated,
      ...(commands[0] ? { failed: commands[0] } : {}),
    };
  }
  const body = lines.map((line, index) => {
    const continued = (lines[index - 1] ?? "").trimEnd().endsWith("\\");
    const result = continued ? undefined : known.get(line.trim());
    if (!result) return line;
    const allowed = excused.has(line.trim());
    const code = allowed ? 0 : result.exitCode;
    const note = allowed
      ? `exit ${result.exitCode}, preexisting: it already failed before the task and did not get worse`
      : `exit ${result.exitCode}, from the regression check`;
    return `bae_reuse ${code} ${quote(line.trim())} ${quote(note)}`;
  });
  options.onOutput?.(`${lines.map((line) => `$ ${line}`).join("\n")}\n`);
  const result = await runScript(options.bash, [...HEADER, ...body, ""].join("\n"), {
    cwd,
    onOutput: options.onOutput,
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
