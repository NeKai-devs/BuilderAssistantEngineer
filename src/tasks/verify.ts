import { runShell, type ShellResult } from "../core/process.js";

export type Unsafe = { command: string; reason: string };
export type CommandRun = { command: string } & ShellResult;
export type VerificationRun = { passed: boolean; runs: CommandRun[] };

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
  commands: string[],
  onOutput?: (chunk: string) => void,
): Promise<VerificationRun> {
  const runs: CommandRun[] = [];
  for (const command of commands) {
    onOutput?.(`$ ${command}\n`);
    const result = await runShell(command, { cwd, onOutput });
    runs.push({ command, ...result });
    if (result.exitCode !== 0) return { passed: false, runs };
  }
  return { passed: true, runs };
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
