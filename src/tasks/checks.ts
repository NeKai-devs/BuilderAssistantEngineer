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
    "php composer phpunit pest phpstan psalm bundle rake rspec ruby rails rubocop mix elixir swift xcodebuild flutter dart shellcheck"
  ).split(" "),
);
const CHECKS = new Set(["test", "[", "[[", "grep", "egrep", "fgrep", "rg", "diff", "cmp"]);
const HELPERS = new Set(
  "cd echo printf ls cat pwd true : export sleep head tail wc sort uniq tee mkdir touch cp which command".split(
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
const DYNAMIC = new Set(["eval", "source", ".", "exec", "xargs"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "pwsh", "powershell", "cmd"]);
const MASKING =
  /\|\|\s*(?:true|:|exit\s+0|echo\b|printf\b|return\s+0)(?:\s|;|$)|\bset\s+\+[A-Za-z]*e\b|\bset\s+\+o\s+(?:errexit|pipefail)\b/;

export function trivialityProblems(lines: string[]): CheckProblem[] {
  const logical = logicalLines(lines);
  const masked = logical
    .filter((line) => MASKING.test(line))
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
    if (allow.some((prefix) => line.startsWith(prefix))) return [];
    const parsed = parseLine(line);
    if (parsed.substitution) return [{ command: line, reason: "dynamic" as const }];
    const bad = parsed.commands.find((command) => !allowed(command));
    if (!bad) return [];
    const { name } = program(bad);
    const dynamic = DYNAMIC.has(name) || SHELLS.has(name);
    return [{ command: line, reason: dynamic ? ("dynamic" as const) : ("notAllowed" as const) }];
  });
}

function runsOrChecks(command: SimpleCommand): boolean {
  const { name, args } = program(command);
  const base = baseName(name);
  if (RUNNERS.has(base)) return true;
  if (CHECKS.has(base)) return true;
  if (base === "curl")
    return args.some((arg) => /^(-[a-zA-Z]*f[a-zA-Z]*|--fail(-with-body)?)$/.test(arg));
  if (base === "jq") return args.some((arg) => /^(-[a-zA-Z]*e[a-zA-Z]*|--exit-status)$/.test(arg));
  if (base === "git")
    return args[0] === "diff" && args.some((arg) => arg === "--exit-code" || arg === "--quiet");
  return false;
}

function allowed(command: SimpleCommand): boolean {
  const { name, args } = program(command);
  const base = baseName(name);
  if (DYNAMIC.has(base) || SHELLS.has(base)) return false;
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

function baseName(name: string): string {
  return name.split("/").at(-1) ?? name;
}
