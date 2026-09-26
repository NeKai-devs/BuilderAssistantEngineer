import type { Dirent } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { readTextIfExists, writeText } from "../core/fs.js";
import { gitPaths, isGitRepo } from "../core/git.js";
import { asRecord, parseObject } from "../core/json.js";
import { scanFiles } from "../digest/walk.js";
import { type IgnoreSource, ignoreMatcher, untrackedFiles } from "./ignore-rules.js";
import {
  AGENT_FILES,
  BAE_SCRATCH,
  type ContractKind,
  createdIsViolation,
  executedBy,
  GIT_FILES,
  isRunnerConfig,
  kindOf,
  repoProtected,
  sectionsOf,
  setupReferences,
  shadowCandidates,
  WATCHED_DIRS,
} from "./protected-files.js";

export type { ContractKind } from "./protected-files.js";
export { isAcceptableKind, TASKS_DIR } from "./protected-files.js";

export type ContractChange = {
  path: string;
  kind: ContractKind;
  change: "modified" | "deleted" | "created";
  detail: string;
  restored: string | null;
};
export type Protected = Record<string, string>;
export type ContractInputs = { suite: string[]; verification: string[]; own: string[] };
export type Collected = { protected: Protected; shadows: string[] };
export type ContractState = {
  protected: Protected;
  shadows: string[];
  ignore: IgnoreSource[];
  taskPath: string;
};

const LOG_HEADING = /^##[ \t]+(log|registro|bitácora|bitacora)[ \t]*$/i;
const SECTION_HEADING = /^##(?!#)/;
const FRONTMATTER = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;
const MAX_PROTECTED_CHARS = 1_000_000;
const PACKAGE_KEYS = ["jest", "mocha", "ava"];

export async function collectProtected(
  cwd: string,
  inputs: ContractInputs = { suite: [], verification: [], own: [] },
): Promise<Collected> {
  const listing = await repoFiles(cwd);
  const scripts = asRecord(
    parseObject((await readTextIfExists(absolute(cwd, "package.json"))) ?? "")?.scripts,
  );
  const suite = executedBy(inputs.suite, scripts);
  const verification = executedBy(inputs.verification, scripts);
  const own = new Set(inputs.own);
  const candidates = [
    ...(await watchedFiles(cwd)),
    ...listing.filter(repoProtected),
    ...suite.files,
    ...verification.files.filter((path) => !own.has(path)),
    ...(await gitFiles(cwd)),
  ];
  const result: Protected = {};
  for (const path of [...new Set(candidates)].sort()) {
    const text = await readTextIfExists(absolute(cwd, path)).catch(() => undefined);
    if (text === undefined || text.length > MAX_PROTECTED_CHARS || !tracked(path, text)) continue;
    result[path] = text;
    if (!isRunnerConfig(path)) continue;
    for (const reference of setupReferences(path, text)) {
      const setup = await readTextIfExists(absolute(cwd, reference)).catch(() => undefined);
      if (setup !== undefined && setup.length <= MAX_PROTECTED_CHARS) result[reference] = setup;
    }
  }
  const existing = new Set(listing);
  const shadows = shadowCandidates({
    files: [],
    modules: [...suite.modules, ...verification.modules],
    make: suite.make || verification.make,
  }).filter((entry) =>
    entry.endsWith("/")
      ? !listing.some((path) => path.startsWith(entry))
      : !existing.has(entry) && !Object.hasOwn(result, entry),
  );
  return { protected: result, shadows };
}

export async function checkContract(cwd: string, state: ContractState): Promise<ContractChange[]> {
  const captured = state.protected;
  const changes: ContractChange[] = [];
  for (const [path, before] of Object.entries(captured)) {
    const after = await readTextIfExists(absolute(cwd, path)).catch(() => undefined);
    const change = compare(path, kindOf(path, state.taskPath), before, after);
    if (change) changes.push(change);
  }
  const created = (path: string, kind: ContractKind): ContractChange => ({
    path,
    kind,
    change: "created",
    detail: "",
    restored: null,
  });
  for (const path of await watchedFiles(cwd)) {
    if (!Object.hasOwn(captured, path)) changes.push(created(path, kindOf(path, state.taskPath)));
  }
  for (const path of await gitFiles(cwd)) {
    if (Object.hasOwn(captured, path)) continue;
    if ((await readTextIfExists(absolute(cwd, path)).catch(() => undefined)) !== undefined) {
      changes.push(created(path, "gitdir"));
    }
  }
  const reported = new Set(changes.map((change) => change.path));
  for (const path of await currentFiles(cwd, state.ignore)) {
    if (reported.has(path) || Object.hasOwn(captured, path)) continue;
    if (
      state.shadows.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry))
    ) {
      changes.push(created(path, "shadow"));
    } else if (createdIsViolation(path)) {
      changes.push(created(path, kindOf(path, state.taskPath)));
    }
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
  const lines = (match?.[1] ?? "").split("\n");
  const status = lines.findIndex((line) => /^status[ \t]*:/.test(line));
  const front = lines.filter((_, index) => index !== status).join("\n");
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
  const headers = sectionsOf(path);
  if (kind === "runner" && headers) {
    const changed = headers.filter(
      (header) => (sectionOf(after, header) ?? "") !== (sectionOf(before, header) ?? ""),
    );
    if (changed.length === 0) return undefined;
    const restored = changed.reduce(
      (text, header) => replaceSection(text, header, sectionOf(before, header) ?? ""),
      after,
    );
    return { ...base, detail: changed.join(", "), change: "modified", restored };
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

function unix(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function tracked(path: string, text: string): boolean {
  const headers = sectionsOf(path);
  return headers === undefined || headers.some((header) => sectionOf(text, header) !== undefined);
}

async function watchedFiles(cwd: string): Promise<string[]> {
  const files = (await Promise.all(WATCHED_DIRS.map((dir) => walk(cwd, dir)))).flat();
  const agents = await Promise.all(
    AGENT_FILES.map(async (path) =>
      (await readTextIfExists(absolute(cwd, path)).catch(() => undefined)) === undefined
        ? []
        : [path],
    ),
  );
  return [...files, ...agents.flat()].filter(
    (path) => !BAE_SCRATCH.some((prefix) => path.startsWith(prefix)),
  );
}

async function gitFiles(cwd: string): Promise<string[]> {
  const info = await stat(join(cwd, ".git")).catch(() => undefined);
  return info?.isDirectory() ? GIT_FILES.map((name) => `.git/${name}`) : [];
}

async function repoFiles(cwd: string): Promise<string[]> {
  if (await isGitRepo(cwd)) {
    return (await gitPaths(cwd, ["ls-files", "--cached", "--others", "--exclude-standard"])) ?? [];
  }
  return (await scanFiles(cwd)).files.map((file) => file.path);
}

async function currentFiles(cwd: string, ignore: IgnoreSource[]): Promise<string[]> {
  if (!(await isGitRepo(cwd))) return (await scanFiles(cwd)).files.map((file) => file.path);
  const [tracked, untracked] = await Promise.all([
    gitPaths(cwd, ["ls-files", "--cached"]),
    untrackedFiles(cwd, ignoreMatcher(ignore)),
  ]);
  return [...(tracked ?? []), ...(untracked ?? [])];
}
