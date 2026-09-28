import type { Config } from "../config/schema.js";
import { suiteCommands } from "../gates/regression.js";
import { allowlistProblems } from "../tasks/checks.js";
import { type Task, verificationScript } from "../tasks/schema.js";
import { logicalLines, parseLine, program } from "../tasks/shell-words.js";

const NPM = ["npm install", "npm ci", "npm init", "npm --version", "node --version"];
const BUN = ["bun install", "bun add", "bun init", "bun --version"];
const INSTALLERS: Record<string, string[]> = {
  npm: NPM,
  npx: NPM,
  pnpm: ["pnpm install", "pnpm add", "pnpm init", "pnpm --version", "node --version"],
  yarn: ["yarn install", "yarn add", "yarn init", "yarn --version", "node --version"],
  bun: BUN,
  bunx: BUN,
  uv: ["uv sync", "uv add", "uv init", "uv --version"],
  poetry: ["poetry install", "poetry add", "poetry init", "poetry --version"],
  pip: ["pip install", "pip --version", "python --version"],
  pip3: ["pip3 install", "pip3 --version", "python3 --version"],
  pytest: ["pip install", "python --version"],
  python: ["python -m pip install", "python --version"],
  python3: ["python3 -m pip install", "python3 --version"],
  go: ["go mod tidy", "go mod download", "go get", "go mod init", "go version"],
  cargo: ["cargo fetch", "cargo add", "cargo init", "cargo --version"],
  dotnet: ["dotnet restore", "dotnet add", "dotnet new", "dotnet --version"],
};
const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const RUN_VERBS = new Set(["run", "exec", "x", "dlx"]);
const INTERPRETERS = new Set(["node", "python", "python3", "bash", "sh", "deno", "ruby", "perl"]);
const SKIPPED = new Set(["", "cd", "export", "set", "true", "false"]);
const RULE_BREAKING = /[(),'"`$\\*;&|<>]/;
const LOOKUPS = new Set([
  "which",
  "type",
  "ls",
  "cat",
  "pwd",
  "echo",
  "printf",
  "env",
  "printenv",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "sort",
  "uniq",
  "diff",
  "stat",
  "true",
  "test",
]);
const GIT_READS = new Set(["status", "log", "diff", "show", "ls-remote", "branch", "rev-parse"]);
const INFO_FLAGS = new Set(["--version", "-v", "-V", "--help", "-h", "version"]);
const HELPERS = [
  "echo",
  "printf",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "ls",
  "pwd",
  "sort",
  "uniq",
  "diff",
  "which",
  "true",
  "test",
  "git status",
  "git diff",
  "git log",
  "git show",
];

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
  return [...new Set([...commands, ...installs, ...HELPERS])].filter(
    (command) => !RULE_BREAKING.test(command),
  );
}

export function briefCommands(commands: string[]): string[] {
  return commands.filter(
    (command) => !commands.some((other) => other !== command && command.startsWith(`${other} `)),
  );
}

export function affectsChecks(denied: string): boolean {
  return firstNeeded(denied) !== undefined;
}

export function ruleHint(denied: string): string {
  const words = firstNeeded(denied) ?? [];
  return [...prefix(words), words.join(" ")][0] ?? denied;
}

function firstNeeded(denied: string): string[] | undefined {
  return parseLine(denied)
    .commands.map((command) => {
      const { name, args } = program(command);
      return [name, ...args];
    })
    .find((words) => needed(words));
}

function needed([name = "", ...args]: string[]): boolean {
  if (SKIPPED.has(name) || LOOKUPS.has(baseName(name))) return false;
  if (name === "git") return !GIT_READS.has(gitSubcommand(args) ?? "");
  return !(args.length > 0 && args.every((arg) => INFO_FLAGS.has(arg)));
}

function gitSubcommand(args: string[]): string | undefined {
  let index = 0;
  while (args[index] === "-C" || args[index] === "-c") index += 2;
  return args[index];
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
