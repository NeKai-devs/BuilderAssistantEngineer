import { join } from "node:path";
import { readTextIfExists } from "../core/fs.js";
import { asRecord, parseObject } from "../core/json.js";
import { COMMAND_KEYS, type CommandKey, type Commands } from "./schema.js";

type Runner = "npm" | "pnpm" | "yarn" | "bun";

const NPM_SCRIPTS: Record<CommandKey, string[]> = {
  test: ["test"],
  lint: ["lint"],
  typecheck: ["typecheck", "type-check", "check-types", "types"],
  build: ["build"],
};

const PLACEHOLDER_TEST = /no test specified/;

const LOCKFILES: [string, Runner][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];

const DEFAULTS: [string, Commands][] = [
  ["go.mod", { test: "go test -v ./...", lint: "go vet ./...", build: "go build ./..." }],
  [
    "Cargo.toml",
    { test: "cargo test", lint: "cargo clippy", typecheck: "cargo check", build: "cargo build" },
  ],
];

const PYTHON_TOOLS: [CommandKey, RegExp, string][] = [
  ["test", /\bpytest\b/, "pytest"],
  ["lint", /\bruff\b/, "ruff check ."],
  ["lint", /\bflake8\b/, "flake8"],
  ["typecheck", /\bmypy\b/, "mypy ."],
  ["typecheck", /\bpyright\b/, "pyright"],
];

export async function proposeCommands(cwd: string): Promise<Commands> {
  const read = (name: string) => readTextIfExists(join(cwd, name));
  const [pkg, makefile, ...python] = await Promise.all(
    ["package.json", "Makefile", "pyproject.toml", "requirements.txt", "requirements-dev.txt"].map(
      read,
    ),
  );
  const inferred = await Promise.all(
    DEFAULTS.map(async ([file, commands]) => ((await read(file)) === undefined ? {} : commands)),
  );
  return fillCommands(
    pkg ? fromScripts(pkg, await detectRunner(cwd, pkg)) : {},
    makefile ? fromMakefile(makefile) : {},
    fromPython(python.join("\n")),
    ...inferred,
  );
}

export function fillCommands(...sources: (Commands | undefined)[]): Commands {
  const commands: Commands = {};
  for (const key of COMMAND_KEYS) {
    const value = sources.map((source) => source?.[key]?.trim()).find(Boolean);
    if (value) commands[key] = value;
  }
  return commands;
}

function fromScripts(text: string, runner: Runner): Commands {
  const scripts = asRecord(parseObject(text)?.scripts);
  const commands: Commands = {};
  for (const key of COMMAND_KEYS) {
    const name = NPM_SCRIPTS[key].find((candidate) => typeof scripts[candidate] === "string");
    if (!name || (key === "test" && PLACEHOLDER_TEST.test(String(scripts[name])))) continue;
    commands[key] =
      runner !== "bun" && name === "test" ? `${runner} test` : `${runner} run ${name}`;
  }
  return commands;
}

async function detectRunner(cwd: string, pkg: string): Promise<Runner> {
  const declared = String(parseObject(pkg)?.packageManager ?? "").split("@")[0];
  if (declared === "pnpm" || declared === "yarn" || declared === "bun") return declared;
  for (const [file, runner] of LOCKFILES) {
    if ((await readTextIfExists(join(cwd, file))) !== undefined) return runner;
  }
  return "npm";
}

function fromMakefile(text: string): Commands {
  const commands: Commands = {};
  for (const key of COMMAND_KEYS) {
    if (new RegExp(`^${key}\\s*:`, "m").test(text)) commands[key] = `make ${key}`;
  }
  return commands;
}

function fromPython(text: string): Commands {
  const lower = text.toLowerCase();
  const commands: Commands = {};
  for (const [key, pattern, command] of PYTHON_TOOLS) {
    if (!commands[key] && pattern.test(lower)) commands[key] = command;
  }
  return commands;
}
