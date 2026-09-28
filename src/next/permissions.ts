import type { Config } from "../config/schema.js";
import { suiteCommands } from "../gates/regression.js";
import { allowlistProblems } from "../tasks/checks.js";
import { type Task, verificationScript } from "../tasks/schema.js";
import { logicalLines, parseLine, program } from "../tasks/shell-words.js";

const INSTALLERS: Record<string, string[]> = {
  npm: ["npm install", "npm ci"],
  npx: ["npm install", "npm ci"],
  pnpm: ["pnpm install", "pnpm add"],
  yarn: ["yarn install", "yarn add"],
  bun: ["bun install", "bun add"],
  bunx: ["bun install", "bun add"],
  uv: ["uv sync", "uv add"],
  poetry: ["poetry install", "poetry add"],
  pip: ["pip install"],
  pip3: ["pip3 install"],
  pytest: ["pip install"],
  python: ["python -m pip install"],
  python3: ["python3 -m pip install"],
  go: ["go mod tidy", "go mod download", "go get"],
  cargo: ["cargo fetch", "cargo add"],
  dotnet: ["dotnet restore", "dotnet add"],
};
const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const RUN_VERBS = new Set(["run", "exec", "x", "dlx"]);
const INTERPRETERS = new Set(["node", "python", "python3", "bash", "sh", "deno", "ruby", "perl"]);
const SKIPPED = new Set(["", "cd", "export", "set", "true", "false"]);
const RULE_BREAKING = /[(),'"`$\\*;&|<>]/;
const LOOKUPS = new Set(["which", "type", "ls", "cat", "pwd", "echo", "env", "printenv", "head"]);
const GIT_READS = new Set(["status", "log", "diff", "show", "ls-remote", "branch", "rev-parse"]);
const INFO_FLAGS = new Set(["--version", "-v", "-V", "--help", "-h", "version"]);

export function agentCommands(config: Config, task: Task): string[] {
  const lines = [
    ...suiteCommands(config).map((item) => item.command),
    ...verificationScript(task.body),
  ];
  const allowed = logicalLines(lines).filter(
    (line) => allowlistProblems([line], config.verify.allow).length === 0,
  );
  const words = allowed
    .flatMap((line) => parseLine(line).commands)
    .map((command) => {
      const { name, args } = program(command);
      return [name, ...args];
    })
    .filter(([name = ""]) => !SKIPPED.has(name));
  const installs = words.flatMap(([name = ""]) => INSTALLERS[baseName(name)] ?? []);
  const commands = words.flatMap((command) => [command.join(" "), ...prefix(command)]);
  return [...new Set([...commands, ...installs])].filter((command) => !RULE_BREAKING.test(command));
}

export function affectsChecks(denied: string): boolean {
  const [name = "", ...args] = denied.trim().split(/\s+/);
  if (LOOKUPS.has(name)) return false;
  if (name === "git" && GIT_READS.has(args[0] ?? "")) return false;
  return !(args.length > 0 && args.every((arg) => INFO_FLAGS.has(arg)));
}

function prefix([first = "", second, third]: string[]): string[] {
  if (RUNNERS.has(first) && RUN_VERBS.has(second ?? "") && third) {
    return [`${first} ${second} ${third}`];
  }
  if ((first === "python" || first === "python3") && second === "-m" && third) {
    return [`${first} -m ${third}`];
  }
  if (second && /^[A-Za-z][\w:-]*$/.test(second)) return [`${first} ${second}`];
  return INTERPRETERS.has(first) ? [] : [first];
}

function baseName(name: string): string {
  return name.split(/[\\/]/).at(-1) ?? name;
}
