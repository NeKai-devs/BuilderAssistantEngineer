import { stripVTControlCharacters } from "node:util";
import { parseLine, program } from "../tasks/shell-words.js";

const PYTHONS = /^(python[\d.]*|py)(\.exe)?$/i;
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const RUN_VERBS = new Set(["run", "run-script"]);

export function missingTool(command: string, output: string): boolean {
  const commands = parseLine(command).commands;
  const [only] = commands;
  if (commands.length !== 1 || !only) return false;
  const { name, args } = program(only);
  const text = stripVTControlCharacters(output);
  const base = name.split(/[\\/]/).at(-1) ?? name;
  if (PYTHONS.test(base)) return missingModule(args, text);
  if (PACKAGE_MANAGERS.has(base)) return missingScript(base, args, text);
  return false;
}

function missingModule(args: string[], text: string): boolean {
  const flag = args.indexOf("-m");
  const module = flag === -1 ? undefined : args[flag + 1];
  if (!module) return false;
  const line = new RegExp(`: No module named ${literal(module)}\\s*$`, "m");
  return line.test(text);
}

function missingScript(manager: string, args: string[], text: string): boolean {
  const script = scriptName(manager, args);
  if (!script) return false;
  const name = literal(script);
  return [
    new RegExp(`missing script:\\s*"?${name}"?\\s*$`, "im"),
    new RegExp(`Command "${name}" not found`),
    new RegExp(`Couldn't find a script named "${name}"`),
    new RegExp(`Script not found "${name}"`),
    new RegExp(`None of the selected packages has a "${name}" script`),
  ].some((pattern) => pattern.test(text));
}

function scriptName(manager: string, args: string[]): string | undefined {
  const words = args.filter((arg) => !arg.startsWith("-"));
  const [first, second] = words;
  if (!first) return undefined;
  if (RUN_VERBS.has(first)) return second;
  if (first === "test" || first === "t") return "test";
  return manager === "npm" ? undefined : first;
}

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
