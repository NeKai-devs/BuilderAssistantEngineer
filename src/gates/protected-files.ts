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
  | "shadow";

export const TASKS_DIR = "docs/plan/tasks";
export const WATCHED_DIRS = [".bae", ".claude/agents", ".opencode", ".gemini", ".codex", TASKS_DIR];
export const AGENT_FILES = [".claude/settings.json", "opencode.json", "opencode.jsonc"];
export const BAE_SCRATCH = [".bae/tmp/"];
export const GIT_FILES = ["config", "info/attributes"];

const MEMORY_FILES = new Set(["AGENTS.md", "AGENTS.override.md", "CLAUDE.md", "GEMINI.md"]);
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
];
const SECTIONS: Record<string, string[]> = {
  "pyproject.toml": ["[tool.pytest.ini_options]", "[tool.ruff]", "[tool.ruff.lint]", "[tool.mypy]"],
  "setup.cfg": ["[tool:pytest]", "[flake8]", "[mypy]"],
  "tox.ini": ["[pytest]", "[flake8]"],
};
const RUNNER_CONFIGS = /^(vitest|vite|jest|playwright|cypress)\.config\.[cm]?[jt]s$|^\.mocharc/;
const SETUP_KEYS =
  /\b(setupFiles|setupFilesAfterEach|setupFilesAfterEnv|globalSetup|globalTeardown|require)\b\s*[:=]\s*(\[[^\]]*\]|["'][^"']+["'])/g;
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
  if (MEMORY_FILES.has(path)) return "memory";
  const name = baseName(path);
  if (name === ".gitignore") return "gitignore";
  if (name === ".gitattributes") return "git";
  if (name === "package.json") return "scripts";
  if (isToolchain(path)) return "toolchain";
  return "runner";
}

export function repoProtected(path: string): boolean {
  if (path.split("/").includes("node_modules")) return false;
  const name = baseName(path);
  return (
    MEMORY_FILES.has(path) ||
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
  return MEMORY_FILES.has(path) || baseName(path) === ".gitattributes" || isToolchain(path);
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
    for (const quoted of (match[2] ?? "").matchAll(/["']([^"']+)["']/g)) {
      const raw = (quoted[1] ?? "").replace(/^\.\//, "");
      if (!looksLikePath(raw)) continue;
      found.push(dir ? `${dir}/${raw}` : raw);
    }
  }
  return found;
}

export type Executed = { files: string[]; modules: string[]; make: boolean };

export function executedBy(commands: string[], scripts: Record<string, unknown>): Executed {
  const files = new Set<string>();
  const modules = new Set<string>();
  let make = false;
  const seen = new Set<string>();
  const pending = [...commands];
  while (pending.length > 0) {
    const command = pending.shift() ?? "";
    if (seen.has(command)) continue;
    seen.add(command);
    for (const simple of parseLine(command).commands) {
      const { name, args } = program(simple);
      const script = npmScript(name, args);
      if (script && typeof scripts[script] === "string") pending.push(scripts[script] as string);
      if (name === "make") make = true;
      if (looksLikePath(name) || /^\.\/(gradlew|mvnw)$/.test(name)) files.add(clean(name));
      if (!INTERPRETERS.has(baseName(name))) continue;
      const moduleIndex = args.indexOf("-m");
      if (PYTHONS.has(baseName(name)) && moduleIndex !== -1) {
        const module = (args[moduleIndex + 1] ?? "").split(".")[0];
        if (module) modules.add(module);
        continue;
      }
      const target = args.filter((arg) => !arg.startsWith("-") && arg !== "run")[0];
      if (target && looksLikePath(target)) files.add(clean(target));
    }
  }
  return { files: [...files], modules: [...modules], make };
}

export function expandScripts(command: string, scripts: Record<string, unknown>): string {
  const seen = new Set<string>();
  const pending = [command];
  const texts: string[] = [];
  while (pending.length > 0) {
    const current = pending.shift() ?? "";
    if (seen.has(current)) continue;
    seen.add(current);
    texts.push(current);
    for (const simple of parseLine(current).commands) {
      const { name, args } = program(simple);
      const script = npmScript(name, args);
      if (script && typeof scripts[script] === "string") pending.push(scripts[script] as string);
    }
  }
  return texts.join("\n");
}

export function shadowCandidates(executed: Executed): string[] {
  return [
    ...(executed.make ? MAKEFILES : []),
    ...executed.modules.flatMap((module) => [`${module}.py`, `${module}/`]),
  ];
}

export function looksLikePath(word: string): boolean {
  if (word.includes("..") || word.startsWith("/") || /^[a-z]+:/i.test(word)) return false;
  return /^(\.\/)?[\w@.-]+(\/[\w@.-]+)*\.(c?js|mjs|ts|mts|cts|tsx|jsx|py|sh|bash|rb|php|pl)$/.test(
    word,
  );
}

export function baseName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function isToolchain(path: string): boolean {
  return TOOLCHAIN_NAMES.has(baseName(path)) || TOOLCHAIN_DIRS.some((dir) => path.startsWith(dir));
}

function npmScript(name: string, args: string[]): string | undefined {
  if (!["npm", "pnpm", "yarn", "bun"].includes(name)) return undefined;
  const rest = args.filter((word) => !word.startsWith("-"));
  if (rest[0] === "run" || rest[0] === "run-script") return rest[1];
  return rest[0] === "test" || rest[0] === "t" ? "test" : undefined;
}

function clean(path: string): string {
  return path.replace(/^\.\//, "");
}
