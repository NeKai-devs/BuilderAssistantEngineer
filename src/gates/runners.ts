import { join } from "node:path";
import { readTextIfExists } from "../core/fs.js";
import { asRecord, parseObject } from "../core/json.js";
import { parseLine, program } from "../tasks/shell-words.js";
import { baseName, execTarget, mainScript, positional } from "./protected-files.js";
import { type RunnerName, runnerHint } from "./results.js";

export type Sources = { scripts: Record<string, unknown>; makefile?: string };
export type Direct = {
  runner: DirectRunner;
  args: string[];
  suffix: (extra: string[]) => string[];
};
export type DirectRunner = "vitest" | "jest" | "pytest" | "go" | "cargo" | "dotnet";

export const TEST_RUNNERS = new Set<RunnerName>([
  "vitest",
  "jest",
  "mocha",
  "node",
  "pytest",
  "go",
  "cargo",
  "rspec",
  "minitest",
  "phpunit",
  "dotnet",
  "surefire",
  "bun",
  "deno",
  "unittest",
  "playwright",
]);

const MAKE = /^(g?make|\$[({]MAKE[)}])$/;
const MAKEFILES = ["GNUmakefile", "makefile", "Makefile"];
const PYTHONS = new Set(["python", "python3", "py"]);
const SCRIPT_HOSTS = new Set(["node", "tsx", "bun"]);
const MANAGERS = new Set(["pnpm", "yarn", "bun"]);
const MAX_DEPTH = 5;

export async function readSources(cwd: string): Promise<Sources> {
  const scripts = asRecord(
    parseObject((await readTextIfExists(join(cwd, "package.json"))) ?? "")?.scripts,
  );
  for (const name of MAKEFILES) {
    const makefile = await readTextIfExists(join(cwd, name));
    if (makefile !== undefined) return { scripts, makefile };
  }
  return { scripts };
}

export function testRunners(command: string, sources: Sources): RunnerName[] {
  return runnerHint(expandCommand(command, sources)).filter((name) => TEST_RUNNERS.has(name));
}

export function expandCommand(command: string, sources: Sources): string {
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
      const wrapped = execTarget(name, args);
      const [inner = name, ...rest] = wrapped ?? [name, ...args];
      const script = mainScript(inner, rest, sources.scripts);
      if (script && typeof sources.scripts[script] === "string") {
        pending.push(sources.scripts[script] as string);
      }
      if (MAKE.test(inner) && sources.makefile) {
        pending.push(...makeRecipes(sources.makefile, makeTargets(rest)));
      }
    }
  }
  return texts.join("\n");
}

export function directRunner(command: string, sources: Sources, depth = 0): Direct | undefined {
  const line = parseLine(command);
  const [simple] = line.commands;
  if (line.substitution || line.commands.length !== 1 || !simple || depth > MAX_DEPTH) {
    return undefined;
  }
  const { name, args } = program(simple);
  const found = runnerOf(name, args);
  if (found) return { ...found, suffix: (extra) => extra };
  const script = mainScript(name, args, sources.scripts);
  const text = script ? sources.scripts[script] : undefined;
  if (typeof text !== "string") return undefined;
  const inner = directRunner(text, sources, depth + 1);
  if (!inner) return undefined;
  const separator = name === "npm" && !args.includes("--") ? ["--"] : [];
  return { ...inner, suffix: (extra) => [...separator, ...inner.suffix(extra)] };
}

export function makeTargets(args: string[]): string[] {
  const targets: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (["-f", "-C", "--file", "--directory", "-I", "-j", "-l", "-o", "-W"].includes(arg)) {
      index++;
      continue;
    }
    if (!arg.startsWith("-") && !arg.includes("=")) targets.push(arg);
  }
  return targets;
}

export function makeRecipes(text: string, targets: string[]): string[] {
  const rules = parseMakefile(text);
  const wanted = targets.length > 0 ? targets : rules.first ? [rules.first] : [];
  const seen = new Set<string>();
  const lines: string[] = [];
  const visit = (target: string): void => {
    if (seen.has(target)) return;
    seen.add(target);
    const rule = rules.targets.get(target);
    if (!rule) return;
    for (const prerequisite of rule.prerequisites) visit(prerequisite);
    lines.push(...rule.recipe);
  };
  for (const target of wanted) visit(target);
  return lines;
}

type Rule = { prerequisites: string[]; recipe: string[] };

function parseMakefile(text: string): { targets: Map<string, Rule>; first?: string } {
  const targets = new Map<string, Rule>();
  let first: string | undefined;
  let current: Rule[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.startsWith("\t")) {
      const recipe = line.trim().replace(/^[@+-]+/, "");
      if (recipe) for (const rule of current) rule.recipe.push(recipe);
      continue;
    }
    const match = /^([^\s:#=][^:=]*?)\s*::?(?!=)\s*([^;#]*)(?:;(.*))?$/.exec(line);
    if (!match) {
      if (line.trim() !== "" && !line.trim().startsWith("#")) current = [];
      continue;
    }
    const names = (match[1] ?? "").split(/\s+/).filter(Boolean);
    const prerequisites = (match[2] ?? "").split(/\s+/).filter((word) => word && word !== "|");
    current = names.map((name) => {
      const rule = targets.get(name) ?? { prerequisites: [], recipe: [] };
      rule.prerequisites.push(...prerequisites);
      if (match[3]?.trim()) rule.recipe.push(match[3].trim());
      targets.set(name, rule);
      return rule;
    });
    first ??= names.find((name) => !name.startsWith("."));
  }
  return { targets, ...(first ? { first } : {}) };
}

function runnerOf(name: string, args: string[]): Omit<Direct, "suffix"> | undefined {
  const wrapped = execTarget(name, args);
  if (wrapped) return runnerOf(wrapped[0] ?? "", wrapped.slice(1));
  const tool = baseName(name.replace(/\\/g, "/")).replace(/\.(c?js|mjs|cmd|exe|ps1)$/i, "");
  const [first] = positional(args);
  const module = args.indexOf("-m");
  if (tool === "vitest") return { runner: "vitest", args };
  if (tool === "jest") return { runner: "jest", args };
  if ((tool === "react-scripts" || tool === "craco") && first === "test") {
    return { runner: "jest", args };
  }
  if (tool === "pytest" || tool === "py.test") return { runner: "pytest", args };
  if (PYTHONS.has(tool) && module !== -1 && args[module + 1] === "pytest") {
    return { runner: "pytest", args };
  }
  if (tool === "go" && first === "test") return { runner: "go", args };
  if (tool === "cargo" && first === "test") return { runner: "cargo", args };
  if (tool === "dotnet" && first === "test") return { runner: "dotnet", args };
  if (SCRIPT_HOSTS.has(tool)) {
    const script = args.find((arg) => !arg.startsWith("-"));
    const path = script?.replace(/\\/g, "/");
    if (script && path && /(^|\/)(vitest|jest)(\.[cm]?js)?$|\/(vitest|jest)\/bin\//.test(path)) {
      return runnerOf(script, args.slice(args.indexOf(script) + 1));
    }
  }
  if (MANAGERS.has(tool) && first && !["run", "test", "exec", "dlx", "x"].includes(first)) {
    return runnerOf(first, args.slice(args.indexOf(first) + 1));
  }
  return undefined;
}
