import { logicalLines, parseLine, program, type SimpleCommand } from "./shell-words.js";

export type CheckProblem = {
  command: string;
  reason: "masks" | "trivial" | "notAllowed" | "dynamic";
};

const RUNNERS = new Set(
  (
    "npm npx pnpm pnpx yarn bun bunx deno node tsx ts-node vitest jest mocha ava tap playwright cypress tsc vue-tsc eslint biome prettier stylelint " +
    "python python3 py pytest tox nox ruff mypy pyright flake8 black isort uv poetry pipenv hatch pdm " +
    "go gofmt golangci-lint staticcheck cargo rustc make cmake ctest ninja gradle gradlew mvn mvnw dotnet java javac kotlinc sbt " +
    "php composer phpunit pest phpstan psalm bundle rake rspec ruby rails rubocop mix elixir swift xcodebuild flutter dart shellcheck " +
    "turbo nx lerna rush just bazel bazelisk moon"
  ).split(" "),
);
const CHECKS = new Set(["test", "[", "[[", "grep", "egrep", "fgrep", "rg", "diff", "cmp"]);
const HELPERS = new Set(
  "cd echo printf ls cat pwd true : export sleep head tail wc sort uniq tee mkdir touch cp which exit set".split(
    " ",
  ),
);
const TRIVIAL = new Set("echo printf ls cat pwd true : exit sleep cd export".split(" "));
const GIT_READ = new Set([
  "diff",
  "status",
  "log",
  "show",
  "ls-files",
  "grep",
  "rev-parse",
  "describe",
  "blame",
]);
const DYNAMIC = new Set(["eval", "source", ".", "exec", "xargs", "command", "builtin", "env"]);
const RELEASING: Record<string, string[]> = {
  npm: ["publish", "unpublish", "deprecate", "owner", "login", "adduser", "dist-tag"],
  pnpm: ["publish", "login"],
  yarn: ["publish", "npm", "login"],
  bun: ["publish"],
  cargo: ["publish", "yank", "owner", "login"],
  docker: ["push", "login"],
  podman: ["push", "login"],
  poetry: ["publish"],
  uv: ["publish"],
  hatch: ["publish"],
  pdm: ["publish"],
  twine: ["upload"],
  gem: ["push", "yank"],
  dotnet: ["nuget"],
  mvn: ["deploy", "release:perform", "release:prepare"],
  mvnw: ["deploy", "release:perform", "release:prepare"],
  gradle: ["publish"],
  gradlew: ["publish"],
  mix: ["hex.publish"],
  dart: ["pub"],
  flutter: ["pub"],
};
const WRAPPERS = new Set(["timeout", "nice", "xvfb-run", "nohup", "time"]);
const HEADERS = new Set(["for", "case", "select", "in"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "pwsh", "powershell", "cmd"]);
const SCRIPT_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const DOWNLOADERS = new Set(["curl", "wget"]);
const MASKING =
  /\bset\s+\+[A-Za-z]*e[A-Za-z]*\b|\bset\s+\+o\s+(?:errexit|pipefail)\b|\btrap\s+-?\s*['"]?\s*['"]?\s+ERR\b/;
const TRAILING_TRUE = /;\s*(?:true|:)\s*$/;
const CHECK_WORDS =
  /^(test|tests|lint|check|typecheck|build|tsc|vitest|jest|mocha|pytest|mypy|ruff|eslint|pyright)$|\.(test|spec)\./;
const STOP_SIGNALS = new Set(["EXIT", "INT", "TERM", "HUP"]);
const FALLBACK_OK =
  /^\s*(?:exit\s+(?:[1-9]\d*|\$\?)|false|\{[^}]*\bexit\s+(?:[1-9]\d*|\$\?)\s*;?\s*\})/;

export function trivialityProblems(lines: string[]): CheckProblem[] {
  const logical = logicalLines(lines);
  const masked = logical
    .filter((line) => MASKING.test(line) || masksWithOperators(line))
    .map((command) => ({ command, reason: "masks" as const }));
  const checks = logical.some((line) =>
    parseLine(line).commands.some((command) => runsOrChecks(command)),
  );
  const trivial =
    logical.length > 0 && !checks
      ? [{ command: logical.join("\n"), reason: "trivial" as const }]
      : [];
  return [...masked, ...trivial];
}

export function allowlistProblems(lines: string[], allow: string[]): CheckProblem[] {
  return logicalLines(lines).flatMap((line) => {
    const parsed = parseLine(line);
    if (parsed.substitution || /[<>]\(/.test(line)) {
      return [{ command: line, reason: "dynamic" as const }];
    }
    const downloads = parsed.commands.some((command) =>
      DOWNLOADERS.has(baseName(program(command).name)),
    );
    const bad = parsed.commands.find(
      (command) =>
        !allow.some((prefix) => command.text.startsWith(prefix)) && !allowed(command, downloads),
    );
    if (!bad) return [];
    const { name } = program(bad);
    const dynamic = DYNAMIC.has(name) || SHELLS.has(name);
    return [{ command: line, reason: dynamic ? ("dynamic" as const) : ("notAllowed" as const) }];
  });
}

function masksWithOperators(line: string): boolean {
  const unquoted = line.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''");
  const fallbacks = unquoted.split("||").slice(1);
  if (fallbacks.some((fallback) => !FALLBACK_OK.test(fallback) && !checksAgain(fallback))) {
    return true;
  }
  if (TRAILING_TRUE.test(unquoted)) return true;
  return backgrounded(line).some((command) => checksSomething(command));
}

function backgrounded(line: string): string[] {
  const marked = line
    .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (quoted) => "_".repeat(quoted.length))
    .replace(/&&|&>|>&|\|&|\d>&\d?/g, (operator) => (operator === "&&" ? "\u0001\u0001" : "  "));
  const found: string[] = [];
  let start = 0;
  for (let index = 0; index < marked.length; index++) {
    const char = marked[index];
    if (char === ";" || char === "|" || char === "\u0001") start = index + 1;
    if (char !== "&") continue;
    found.push(line.slice(start, index).trim());
    start = index + 1;
  }
  return found.filter(Boolean);
}

function checksSomething(command: string): boolean {
  const [first] = parseLine(command).commands;
  if (!first) return false;
  const { name, args } = unwrap(program(first));
  if (CHECKS.has(baseName(name))) return true;
  return [name, ...args].some((word) => CHECK_WORDS.test(baseName(word)));
}

function checksAgain(fallback: string): boolean {
  const [first] = parseLine(fallback.trim()).commands;
  if (!first) return false;
  const { name } = program(first);
  return CHECKS.has(baseName(name));
}

function runsOrChecks(command: SimpleCommand): boolean {
  const { name, args } = unwrap(program(command));
  const base = baseName(name);
  if (RUNNERS.has(base) || runsScriptFile(base, args)) return true;
  if (CHECKS.has(base)) return true;
  if (base === "curl")
    return args.some((arg) => /^(-[a-zA-Z]*f[a-zA-Z]*|--fail(-with-body)?)$/.test(arg));
  if (base === "jq") return args.some((arg) => /^(-[a-zA-Z]*e[a-zA-Z]*|--exit-status)$/.test(arg));
  if (base === "git")
    return args[0] === "diff" && args.some((arg) => arg === "--exit-code" || arg === "--quiet");
  return false;
}

function allowed(command: SimpleCommand, downloads: boolean): boolean {
  if (HEADERS.has(command.words[0] ?? "")) return true;
  const { name, args } = unwrap(program(command));
  const base = baseName(name);
  if (name === "") return true;
  if (!downloads && runsScriptFile(base, args)) return true;
  if (DYNAMIC.has(base) || SHELLS.has(base)) return false;
  if (releases(base, args)) return false;
  if (base === "rm") return safeRemove(args);
  if (base === "kill") return killsOwnJob(args);
  if (base === "trap") return stopsOwnJob(args);
  if (base === "git") return GIT_READ.has(args[0] ?? "");
  if (base === "curl" || base === "jq") return true;
  if (
    !TRIVIAL.has(base) &&
    name.includes("/") &&
    !/(^|\/)node_modules\/\.bin\/|(^|\/)vendor\/bin\//.test(name) &&
    !/^\.\/(gradlew|mvnw)$/.test(name)
  ) {
    return false;
  }
  return RUNNERS.has(base) || CHECKS.has(base) || HELPERS.has(base);
}

function killsOwnJob(args: string[]): boolean {
  const targets = args.filter((arg) => !/^-(?:[A-Z]+|\d+|s)$/.test(arg) && !/^[A-Z]+$/.test(arg));
  return targets.length > 0 && targets.every((target) => /^(?:\$!|%\d*|%%|%\+)$/.test(target));
}

function stopsOwnJob(args: string[]): boolean {
  const [body = "", ...signals] = args;
  const commands = parseLine(body).commands;
  return (
    signals.length > 0 &&
    signals.every((signal) => STOP_SIGNALS.has(signal)) &&
    commands.length > 0 &&
    commands.every((command) => {
      const { name, args: rest } = program(command);
      return baseName(name) === "kill" && killsOwnJob(rest);
    })
  );
}

function runsScriptFile(base: string, args: string[]): boolean {
  if (!SCRIPT_SHELLS.has(base)) return false;
  const script = args.find((arg) => !arg.startsWith("-"));
  const flags = args.slice(0, script ? args.indexOf(script) : args.length);
  if (!script || flags.some((flag) => /^-[a-zA-Z]*[cis]/.test(flag) || flag.startsWith("--"))) {
    return false;
  }
  return (
    !script.startsWith("/") && !script.split(/[\\/]/).includes("..") && !/^[a-z]:/i.test(script)
  );
}

function unwrap(found: { name: string; args: string[] }): { name: string; args: string[] } {
  const base = baseName(found.name);
  if (!WRAPPERS.has(base)) return found;
  let index = 0;
  const args = found.args;
  while (index < args.length && (args[index] ?? "").startsWith("-")) {
    index += /^-(n|s|k|-signal|-kill-after|-server-args)$/.test(args[index] ?? "") ? 2 : 1;
  }
  if (base === "timeout") index++;
  const [name = "", ...rest] = args.slice(index);
  return name ? unwrap({ name, args: rest }) : { name: base, args: [] };
}

function releases(base: string, args: string[]): boolean {
  if (args.includes("--dry-run")) return false;
  const subcommands = RELEASING[base];
  const first = args.find((arg) => !arg.startsWith("-"));
  if (subcommands && first && subcommands.includes(first)) return true;
  if (!["npx", "pnpx", "bunx"].includes(base) || !first) return false;
  const rest = args.slice(args.indexOf(first) + 1);
  return releases(baseName(first), rest);
}

function safeRemove(args: string[]): boolean {
  const paths = args.filter((arg) => !arg.startsWith("-"));
  return (
    paths.length > 0 &&
    paths.every(
      (path) =>
        !/^([/~]|[a-z]:)/i.test(path) &&
        !path.split(/[\\/]/).includes("..") &&
        !/^(\.|\*|\.\/?\*?)$/.test(path) &&
        !path.includes("$"),
    )
  );
}

function baseName(name: string): string {
  return (name.split("/").at(-1) ?? name).replace(/\.(cmd|exe|bat)$/i, "");
}
