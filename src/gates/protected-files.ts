import { parseLine, program } from "../tasks/shell-words.js";

export type ContractKind =
  | "task"
  | "tasks"
  | "bae"
  | "agents"
  | "memory"
  | "gitignore"
  | "git"
  | "gitdir"
  | "scripts"
  | "runner"
  | "toolchain"
  | "shadow"
  | "executed";

export const TASKS_DIR = "docs/plan/tasks";
export const WATCHED_DIRS = [
  ".bae",
  ".claude/agents",
  ".claude/commands",
  ".claude/skills",
  ".claude/hooks",
  ".opencode",
  ".gemini",
  ".codex",
  TASKS_DIR,
];
export const AGENT_FILES = [".claude/settings.json", "opencode.json", "opencode.jsonc"];
export const BAE_SCRATCH = [".bae/tmp/"];
export const GIT_FILES = ["config", "info/attributes"];

const MEMORY_FILES = new Set([
  "AGENTS.md",
  "AGENTS.override.md",
  "CLAUDE.md",
  "CLAUDE.local.md",
  "GEMINI.md",
]);
const TOOLCHAIN_NAMES = new Set([
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnpmfile.cjs",
  "bunfig.toml",
  ".envrc",
]);
const TOOLCHAIN_DIRS = [".yarn/releases/", ".yarn/plugins/"];
const RUNNER_FILES = [
  /^vitest\.(config|workspace)\.[cm]?[jt]s$/,
  /^vite\.config\.[cm]?[jt]s$/,
  /^jest\.config\.([cm]?[jt]s|json)$/,
  /^playwright\.config\.[cm]?[jt]s$/,
  /^cypress\.config\.[cm]?[jt]s$/,
  /^karma\.conf\.[cm]?[jt]s$/,
  /^\.mocharc(\.(c?js|jsonc?|ya?ml))?$/,
  /^pytest\.ini$/,
  /^conftest\.py$/,
  /^phpunit\.xml(\.dist)?$/,
  /^\.rspec$/,
  /^tsconfig(\.[\w-]+)?\.json$/,
  /^jsconfig\.json$/,
  /^eslint\.config\.[cm]?[jt]s$/,
  /^\.eslintrc(\.(c?js|json|ya?ml))?$/,
  /^\.eslintignore$/,
  /^biome\.jsonc?$/,
  /^\.?ruff\.toml$/,
  /^\.flake8$/,
  /^\.?mypy\.ini$/,
  /^\.?pylintrc$/,
  /^\.golangci\.(ya?ml|toml|json)$/,
  /^\.?clippy\.toml$/,
  /^\.stylelintrc(\.\w+)?$/,
  /^phpstan\.neon(\.dist)?$/,
  /^psalm\.xml$/,
  /^\.rubocop\.yml$/,
  /^turbo\.json$/,
  /^nx\.json$/,
  /^project\.json$/,
  /^angular\.json$/,
  /^deno\.jsonc?$/,
  /^\.babelrc(\.\w+)?$/,
  /^babel\.config\.\w+$/,
  /^\.prettierrc(\.\w+)?$/,
  /^prettier\.config\.\w+$/,
  /^\.coveragerc$/,
  /^\.nycrc(\.\w+)?$/,
  /^\.c8rc(\.\w+)?$/,
  /^jest\.setup\.[cm]?[jt]s$/,
];
const SECTIONS: Record<string, string[]> = {
  "pyproject.toml": [
    "tool.pytest",
    "tool.ruff",
    "tool.mypy",
    "tool.coverage",
    "tool.poe",
    "tool.hatch.envs",
    "tool.pdm.scripts",
  ],
  "setup.cfg": ["tool:pytest", "flake8", "mypy", "coverage"],
  "tox.ini": ["pytest", "flake8", "testenv", "tox"],
  "Cargo.toml": ["lints", "workspace.lints"],
};
const RUNNER_CONFIGS =
  /^(vitest|vite|jest|playwright|cypress)\.config\.([cm]?[jt]s|json)$|^\.mocharc|^package\.json$|^\.rspec$/;
const SETUP_KEYS =
  /["']?\b(setupFiles|setupFilesAfterEach|setupFilesAfterEnv|globalSetup|globalTeardown|require|setupFilesAfterFramework)\b["']?\s*[:=]\s*(\[[^\]]*\]|["'][^"']+["'])|(--require)\s+()(\S+)/g;
const INTERPRETERS = new Set([
  "node",
  "tsx",
  "ts-node",
  "python",
  "python3",
  "py",
  "bash",
  "sh",
  "ruby",
  "perl",
  "php",
  "deno",
  "bun",
]);
const PYTHONS = new Set(["python", "python3", "py"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const EXEC_WRAPPERS = new Set(["npx", "pnpx", "bunx"]);
const VALUE_FLAGS = new Set([
  "--prefix",
  "-C",
  "--dir",
  "-w",
  "--workspace",
  "--filter",
  "-F",
  "--cwd",
]);
const MAKEFILES = ["GNUmakefile", "makefile", "Makefile"];
const ACCEPTABLE = new Set<ContractKind>([
  "memory",
  "gitignore",
  "git",
  "scripts",
  "runner",
  "toolchain",
]);

export function isAcceptableKind(kind: ContractKind): boolean {
  return ACCEPTABLE.has(kind);
}

export function kindOf(path: string, taskPath: string): ContractKind {
  if (path === taskPath) return "task";
  if (path.startsWith(`${TASKS_DIR}/`)) return "tasks";
  if (path.startsWith(".bae/")) return "bae";
  if (path.startsWith(".git/")) return "gitdir";
  if (
    [".claude/", ".opencode/", ".gemini/", ".codex/"].some((dir) => path.startsWith(dir)) ||
    AGENT_FILES.includes(path)
  ) {
    return "agents";
  }
  if (MEMORY_FILES.has(baseName(path))) return "memory";
  const name = baseName(path);
  if (name === ".gitignore") return "gitignore";
  if (
    ["turbo.json", "nx.json", "project.json", "angular.json", "deno.json", "deno.jsonc"].includes(
      name,
    )
  ) {
    return "runner";
  }
  if (name === ".gitattributes") return "git";
  if (name === "package.json") return "scripts";
  if (isToolchain(path)) return "toolchain";
  return "runner";
}

export function repoProtected(path: string): boolean {
  if (path.split("/").includes("node_modules")) return false;
  const name = baseName(path);
  return (
    MEMORY_FILES.has(baseName(path)) ||
    name === ".gitignore" ||
    name === ".gitattributes" ||
    name === "package.json" ||
    isToolchain(path) ||
    Object.hasOwn(SECTIONS, name) ||
    RUNNER_FILES.some((pattern) => pattern.test(name))
  );
}

export function createdIsViolation(path: string): boolean {
  if (path.split("/").includes("node_modules")) return false;
  return (
    MEMORY_FILES.has(baseName(path)) || baseName(path) === ".gitattributes" || isToolchain(path)
  );
}

export function sectionsOf(path: string): string[] | undefined {
  return SECTIONS[baseName(path)];
}

export function isRunnerConfig(path: string): boolean {
  return RUNNER_CONFIGS.test(baseName(path));
}

export function setupReferences(configPath: string, text: string): string[] {
  const dir = configPath.split("/").slice(0, -1).join("/");
  const found: string[] = [];
  for (const match of text.matchAll(SETUP_KEYS)) {
    const values = match[2] ?? (match[5] ? `"${match[5]}"` : "");
    for (const quoted of values.matchAll(/["']([^"']+)["']/g)) {
      let raw = (quoted[1] ?? "").replace(/^<rootDir>\//, "").replace(/^\.\//, "");
      if (configPath.endsWith(".rspec") && !raw.includes(".")) raw = `spec/${raw}.rb`;
      if (!looksLikePath(raw)) continue;
      found.push(dir ? `${dir}/${raw}` : raw);
    }
  }
  return found;
}

export type Executed = { files: string[]; programs: string[]; modules: string[]; make: boolean };

export function executedBy(commands: string[], scripts: Record<string, unknown>): Executed {
  const files = new Set<string>();
  const programs = new Set<string>();
  const modules = new Set<string>();
  let make = false;
  const run = (path: string) => {
    files.add(clean(path));
    programs.add(clean(path));
  };
  const seen = new Set<string>();
  const pending = [...commands];
  const visit = (name: string, args: string[]): void => {
    const wrapped = execTarget(name, args);
    if (wrapped) {
      visit(wrapped[0] ?? "", wrapped.slice(1));
      return;
    }
    for (const script of scriptsInvoked(name, args, scripts)) {
      if (typeof scripts[script] === "string") pending.push(scripts[script] as string);
    }
    if (name === "make") {
      make = true;
      for (const file of MAKEFILES) files.add(file);
      const flag = args.indexOf("-f");
      if (flag !== -1 && args[flag + 1]) files.add(clean(args[flag + 1] ?? ""));
    }
    if (looksLikePath(name) || /^\.\/(gradlew|mvnw)$/.test(name)) run(name);
    if (!INTERPRETERS.has(baseName(name))) return;
    const moduleIndex = args.indexOf("-m");
    if (PYTHONS.has(baseName(name)) && moduleIndex !== -1) {
      const module = (args[moduleIndex + 1] ?? "").split(".")[0];
      if (module) modules.add(module);
      return;
    }
    const target = args.filter((arg) => !arg.startsWith("-") && arg !== "run")[0];
    if (target && looksLikePath(target)) run(target);
  };
  while (pending.length > 0) {
    const command = pending.shift() ?? "";
    if (seen.has(command)) continue;
    seen.add(command);
    for (const simple of parseLine(command).commands) {
      const { name, args } = program(simple);
      visit(name, args);
    }
  }
  return { files: [...files], programs: [...programs], modules: [...modules], make };
}

export function shadowCandidates(executed: Executed): string[] {
  return [
    ...(executed.make ? MAKEFILES : []),
    ...executed.modules.flatMap((module) => [`${module}.py`, `${module}/`]),
  ];
}

export function looksLikePath(word: string): boolean {
  if (word.includes("..") || word.startsWith("/") || /^[a-z]+:/i.test(word)) return false;
  if (
    /^(\.\/)?[\w@.-]+(\/[\w@.-]+)*\.(c?js|mjs|ts|mts|cts|tsx|jsx|py|sh|bash|rb|php|pl|ps1|cmd|bat)$/.test(
      word,
    )
  ) {
    return true;
  }
  return /^(\.\/[\w@.-]+|[\w@.-]+(\/[\w@.-]+)+)$/.test(word);
}

export function baseName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function isToolchain(path: string): boolean {
  return TOOLCHAIN_NAMES.has(baseName(path)) || TOOLCHAIN_DIRS.some((dir) => path.startsWith(dir));
}

export function mainScript(
  name: string,
  args: string[],
  scripts: Record<string, unknown>,
): string | undefined {
  return scriptsInvoked(name, args, scripts).find((script) => !/^(pre|post)/.test(script));
}

function scriptsInvoked(name: string, args: string[], scripts: Record<string, unknown>): string[] {
  if (!PACKAGE_MANAGERS.has(name)) return [];
  const rest = positional(args);
  let script: string | undefined;
  if (rest[0] === "run" || rest[0] === "run-script" || rest[0] === "run-s") script = rest[1];
  else if (rest[0] === "test" || rest[0] === "t" || rest[0] === "tst") script = "test";
  else if (name !== "npm" && rest[0] && typeof scripts[rest[0]] === "string") script = rest[0];
  return script ? [`pre${script}`, script, `post${script}`] : [];
}

export function execTarget(name: string, args: string[]): string[] | undefined {
  if (EXEC_WRAPPERS.has(name)) return positional(args, false);
  if (!PACKAGE_MANAGERS.has(name)) return undefined;
  const rest = positional(args, false);
  return rest[0] === "exec" || rest[0] === "dlx" ? rest.slice(1) : undefined;
}

export function positional(args: string[], dropValues = true): string[] {
  const rest: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("-")) {
      rest.push(...(dropValues ? [arg] : args.slice(index)));
      if (!dropValues) break;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) index++;
  }
  return rest;
}

function clean(path: string): string {
  return path.replace(/^\.\//, "");
}
