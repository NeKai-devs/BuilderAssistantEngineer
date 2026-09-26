import type { Dirent } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { readTextIfExists, writeText } from "../core/fs.js";
import { gitPaths, isGitRepo } from "../core/git.js";
import { asRecord, parseObject } from "../core/json.js";
import { scanFiles } from "../digest/walk.js";

export type ContractKind = "task" | "tasks" | "bae" | "agents" | "gitignore" | "scripts" | "runner";
export type ContractChange = {
  path: string;
  kind: ContractKind;
  change: "modified" | "deleted" | "created";
  detail: string;
  restored: string | null;
};
export type Protected = Record<string, string>;

export const TASKS_DIR = "docs/plan/tasks";
const WATCHED_DIRS = [".bae", ".claude/agents", ".opencode/agent", ".opencode/agents", TASKS_DIR];
const AGENT_FILES = [".claude/settings.json", "opencode.json", "opencode.jsonc"];
const BAE_SCRATCH = [".bae/tmp/", ".bae/runs/"];
const PACKAGE_KEYS = ["jest", "mocha", "ava"];
const RUNNER_FILES = [
  /^vitest\.(config|workspace)\.[cm]?[jt]s$/,
  /^jest\.config\.([cm]?[jt]s|json)$/,
  /^playwright\.config\.[cm]?[jt]s$/,
  /^cypress\.config\.[cm]?[jt]s$/,
  /^karma\.conf\.[cm]?[jt]s$/,
  /^\.mocharc(\.(c?js|jsonc?|ya?ml))?$/,
  /^pytest\.ini$/,
  /^phpunit\.xml(\.dist)?$/,
  /^\.rspec$/,
];
const VITE_CONFIG = /^vite\.config\.[cm]?[jt]s$/;
const VITE_TEST = /\btest\s*:/;
const RUNNER_SECTIONS: Record<string, string> = {
  "pyproject.toml": "[tool.pytest.ini_options]",
  "setup.cfg": "[tool:pytest]",
  "tox.ini": "[pytest]",
};
const LOG_HEADING = /^##[ \t]+(log|registro|bitácora|bitacora)[ \t]*$/i;
const SECTION_HEADING = /^##(?!#)/;
const FRONTMATTER = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;
const MAX_PROTECTED_CHARS = 1_000_000;
const ACCEPTABLE = new Set<ContractKind>(["gitignore", "scripts", "runner"]);

export function isAcceptableKind(kind: ContractKind): boolean {
  return ACCEPTABLE.has(kind);
}

export async function collectProtected(cwd: string): Promise<Protected> {
  const candidates = [
    ...(await watchedFiles(cwd)),
    ...(await repoFiles(cwd)).filter((path) => repoProtected(path)),
  ];
  const result: Protected = {};
  for (const path of [...new Set(candidates)].sort()) {
    const text = await readTextIfExists(absolute(cwd, path));
    if (text === undefined || text.length > MAX_PROTECTED_CHARS || !tracked(path, text)) continue;
    result[path] = text;
  }
  return result;
}

export async function checkContract(
  cwd: string,
  captured: Protected,
  taskPath: string,
): Promise<ContractChange[]> {
  const changes: ContractChange[] = [];
  for (const [path, before] of Object.entries(captured)) {
    const after = await readTextIfExists(absolute(cwd, path));
    const change = compare(path, kindOf(path, taskPath), before, after);
    if (change) changes.push(change);
  }
  for (const path of await watchedFiles(cwd)) {
    if (Object.hasOwn(captured, path)) continue;
    changes.push({
      path,
      kind: kindOf(path, taskPath),
      change: "created",
      detail: "",
      restored: null,
    });
  }
  return changes;
}

export async function restoreContract(cwd: string, changes: ContractChange[]): Promise<void> {
  for (const change of changes) {
    const target = absolute(cwd, change.path);
    if (change.restored === null) await rm(target, { force: true });
    else await writeText(target, change.restored);
  }
}

export function taskContract(text: string): string {
  const unix = text.replace(/\r\n/g, "\n");
  const match = FRONTMATTER.exec(unix);
  const front = (match?.[1] ?? "")
    .split("\n")
    .filter((line) => !/^status[ \t]*:/.test(line))
    .join("\n");
  const body = match ? unix.slice(match[0].length) : unix;
  return `${front}\n---\n${splitLog(body).kept.join("\n")}`.replace(/\s+$/, "");
}

export function spliceLog(captured: string, current: string): string {
  const log = splitLog(current.replace(/\r\n/g, "\n")).log;
  const output: string[] = [];
  let inLog = false;
  let inserted = false;
  for (const line of captured.replace(/\r\n/g, "\n").split("\n")) {
    if (SECTION_HEADING.test(line)) inLog = LOG_HEADING.test(line.trimEnd());
    if (!inLog) {
      output.push(line);
      continue;
    }
    if (!inserted) output.push(...log);
    inserted = true;
  }
  if (!inserted && log.length > 0) output.push("", ...log);
  return output.join("\n");
}

function splitLog(body: string): { kept: string[]; log: string[] } {
  const kept: string[] = [];
  const log: string[] = [];
  let inLog = false;
  for (const line of body.split("\n")) {
    if (SECTION_HEADING.test(line)) inLog = LOG_HEADING.test(line.trimEnd());
    (inLog ? log : kept).push(line);
  }
  return { kept, log };
}

function compare(
  path: string,
  kind: ContractKind,
  before: string,
  after: string | undefined,
): ContractChange | undefined {
  const base = { path, kind, detail: "" };
  if (after === undefined) return { ...base, change: "deleted", restored: before };
  if (kind === "task") {
    if (taskContract(before) === taskContract(after)) return undefined;
    return { ...base, change: "modified", restored: spliceLog(before, after) };
  }
  if (kind === "scripts") {
    const keys = packageChanges(before, after);
    if (keys.length === 0) return undefined;
    const detail = keys.join(", ");
    return { ...base, detail, change: "modified", restored: restorePackage(before, after) };
  }
  const header = RUNNER_SECTIONS[baseName(path)];
  if (kind === "runner" && header) {
    const section = sectionOf(before, header) ?? "";
    if (sectionOf(after, header) === section) return undefined;
    return {
      ...base,
      detail: header,
      change: "modified",
      restored: replaceSection(after, header, section),
    };
  }
  if (unix(before) === unix(after)) return undefined;
  return { ...base, change: "modified", restored: before };
}

function packageChanges(before: string, after: string): string[] {
  const previous = parseObject(before) ?? {};
  const current = parseObject(after);
  if (!current) return ["package.json"];
  const scripts = asRecord(previous.scripts);
  const now = asRecord(current.scripts);
  return [
    ...Object.keys(scripts)
      .filter((key) => now[key] !== scripts[key])
      .map((key) => `scripts.${key}`),
    ...PACKAGE_KEYS.filter(
      (key) => key in previous && JSON.stringify(current[key]) !== JSON.stringify(previous[key]),
    ),
  ];
}

function restorePackage(before: string, after: string): string {
  const previous = parseObject(before) ?? {};
  const current = parseObject(after);
  if (!current) return before;
  const restored: Record<string, unknown> = { ...current };
  if (previous.scripts !== undefined) {
    restored.scripts = { ...asRecord(current.scripts), ...asRecord(previous.scripts) };
  }
  for (const key of PACKAGE_KEYS.filter((name) => name in previous)) restored[key] = previous[key];
  const indent = /\n([ \t]+)"/.exec(after)?.[1] ?? "  ";
  return `${JSON.stringify(restored, null, indent)}${after.endsWith("\n") ? "\n" : ""}`;
}

function sectionOf(text: string, header: string): string | undefined {
  const lines = unix(text).split("\n");
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
  return lines
    .slice(start, end === -1 ? lines.length : end)
    .join("\n")
    .trimEnd();
}

function replaceSection(text: string, header: string, section: string): string {
  const lines = unix(text).split("\n");
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return section ? `${unix(text).trimEnd()}\n\n${section}\n` : text;
  const found = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
  const end = found === -1 ? lines.length : found;
  const rest = end < lines.length ? ["", ...lines.slice(end)] : [""];
  return [...lines.slice(0, start), ...(section ? [section] : []), ...rest].join("\n");
}

function kindOf(path: string, taskPath: string): ContractKind {
  if (path === taskPath) return "task";
  if (path.startsWith(`${TASKS_DIR}/`)) return "tasks";
  if (path.startsWith(".bae/")) return "bae";
  if (path.startsWith(".claude/") || path.startsWith(".opencode/") || AGENT_FILES.includes(path)) {
    return "agents";
  }
  const name = baseName(path);
  if (name === ".gitignore") return "gitignore";
  if (name === "package.json") return "scripts";
  return "runner";
}

function repoProtected(path: string): boolean {
  if (path.split("/").includes("node_modules")) return false;
  const name = baseName(path);
  return (
    name === ".gitignore" ||
    name === "package.json" ||
    VITE_CONFIG.test(name) ||
    Object.hasOwn(RUNNER_SECTIONS, name) ||
    RUNNER_FILES.some((pattern) => pattern.test(name))
  );
}

function tracked(path: string, text: string): boolean {
  const name = baseName(path);
  if (VITE_CONFIG.test(name)) return VITE_TEST.test(text);
  const header = RUNNER_SECTIONS[name];
  return header === undefined || sectionOf(text, header) !== undefined;
}

async function watchedFiles(cwd: string): Promise<string[]> {
  const files = (await Promise.all(WATCHED_DIRS.map((dir) => walk(cwd, dir)))).flat();
  const agents = await Promise.all(
    AGENT_FILES.map(async (path) =>
      (await readTextIfExists(absolute(cwd, path))) === undefined ? [] : [path],
    ),
  );
  return [...files, ...agents.flat()].filter(
    (path) => !BAE_SCRATCH.some((prefix) => path.startsWith(prefix)),
  );
}

async function repoFiles(cwd: string): Promise<string[]> {
  if (await isGitRepo(cwd)) {
    return (await gitPaths(cwd, ["ls-files", "--cached", "--others", "--exclude-standard"])) ?? [];
  }
  return (await scanFiles(cwd)).files.map((file) => file.path);
}

async function walk(cwd: string, dir: string): Promise<string[]> {
  if (BAE_SCRATCH.some((prefix) => `${dir}/`.startsWith(prefix))) return [];
  const entries = await listDir(absolute(cwd, dir));
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return walk(cwd, path);
      return entry.isFile() ? [path] : [];
    }),
  );
  return nested.flat();
}

async function listDir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function absolute(cwd: string, path: string): string {
  return join(cwd, ...path.split("/"));
}

function baseName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function unix(text: string): string {
  return text.replace(/\r\n/g, "\n");
}
