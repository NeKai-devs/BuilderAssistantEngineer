import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { UserError } from "../core/errors.js";
import { readTextIfExists, writeText } from "../core/fs.js";
import { gitPaths, isGitRepo } from "../core/git.js";
import { asRecord, parseObject } from "../core/json.js";
import { scanFiles } from "../digest/walk.js";
import { t } from "../i18n/index.js";
import { inScope } from "../review/scope.js";
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
  fingerprint?: string;
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
const PACKAGE_KEYS = ["jest", "mocha", "ava", "eslintConfig", "prettier", "babel", "c8", "nyc"];
const ROOT_TOOLCHAIN = [
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".envrc",
  "bunfig.toml",
  ".pnpmfile.cjs",
];

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
  const own = (path: string) => inScope(path, inputs.own);
  const candidates = [
    ...(await watchedFiles(cwd)),
    ...listing.filter(repoProtected),
    ...suite.files,
    ...verification.files.filter((path) => !own(path)),
    ...(await rootToolchain(cwd)),
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
    const linked = (await lstat(absolute(cwd, path)).catch(() => undefined))?.isSymbolicLink();
    const after = linked
      ? undefined
      : await readTextIfExists(absolute(cwd, path)).catch(() => undefined);
    const change = compare(path, kindOf(path, state.taskPath), before, after);
    if (change) changes.push({ ...change, fingerprint: fingerprint(after) });
  }
  const created = (path: string, kind: ContractKind): ContractChange => ({
    path,
    kind,
    change: "created",
    detail: "",
    restored: null,
    fingerprint: fingerprint(path),
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
  const failed: string[] = [];
  for (const change of changes) {
    const target = absolute(cwd, change.path);
    try {
      await rm(target, { force: true, recursive: true });
      if (change.restored !== null) await writeText(target, change.restored);
    } catch {
      failed.push(change.path);
    }
  }
  if (failed.length > 0)
    throw new UserError(t("contract.restoreFailed", { files: failed.join(", ") }));
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
  let fenced = false;
  for (const line of captured.replace(/\r\n/g, "\n").split("\n")) {
    if (!fenced && SECTION_HEADING.test(line)) inLog = LOG_HEADING.test(line.trimEnd());
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
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
  let fenced = false;
  for (const line of body.split("\n")) {
    if (!fenced && SECTION_HEADING.test(line)) inLog = LOG_HEADING.test(line.trimEnd());
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    (inLog ? log : kept).push(line);
  }
  return { kept, log };
}

export function withoutLog(text: string): string {
  return splitLog(unix(text)).kept.join("\n").trimEnd();
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
  const hooks = Object.keys(now).filter(
    (key) =>
      !(key in scripts) && /^(pre|post)./.test(key) && key.replace(/^(pre|post)/, "") in scripts,
  );
  return [
    ...Object.keys(scripts)
      .filter((key) => now[key] !== scripts[key])
      .map((key) => `scripts.${key}`),
    ...hooks.map((key) => `scripts.${key}`),
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
    const scripts = asRecord(previous.scripts);
    const kept = Object.entries(asRecord(current.scripts)).filter(
      ([key]) => !(/^(pre|post)./.test(key) && key.replace(/^(pre|post)/, "") in scripts),
    );
    restored.scripts = { ...Object.fromEntries(kept), ...scripts };
  }
  for (const key of PACKAGE_KEYS.filter((name) => name in previous)) restored[key] = previous[key];
  const indent = /\n([ \t]+)"/.exec(after)?.[1] ?? "  ";
  return `${JSON.stringify(restored, null, indent)}${after.endsWith("\n") ? "\n" : ""}`;
}

function sectionOf(text: string, prefix: string): string | undefined {
  const tables = tablesOf(text).filter((table) => matchesTable(table.name, prefix));
  if (tables.length === 0) return undefined;
  return tables.map((table) => table.lines.join("\n").trimEnd()).join("\n\n");
}

function replaceSection(text: string, prefix: string, section: string): string {
  const kept = tablesOf(text)
    .filter((table) => !matchesTable(table.name, prefix))
    .map((table) => table.lines.join("\n").trimEnd())
    .filter((block) => block !== "");
  return `${[...kept, ...(section ? [section] : [])].join("\n\n")}\n`;
}

function tablesOf(text: string): { name: string; lines: string[] }[] {
  const tables: { name: string; lines: string[] }[] = [{ name: "", lines: [] }];
  for (const line of unix(text).split("\n")) {
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:[#;].*)?$/.exec(line)?.[1];
    if (header !== undefined) tables.push({ name: header.trim(), lines: [] });
    tables.at(-1)?.lines.push(line);
  }
  return tables;
}

function matchesTable(name: string, prefix: string): boolean {
  return (
    name === prefix || [".", "-", ":"].some((separator) => name.startsWith(`${prefix}${separator}`))
  );
}

async function walk(cwd: string, dir: string): Promise<string[]> {
  if (BAE_SCRATCH.some((prefix) => `${dir}/`.startsWith(prefix))) return [];
  const entries = await listDir(absolute(cwd, dir));
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return walk(cwd, path);
      return entry.isFile() || entry.isSymbolicLink() ? [path] : [];
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

function fingerprint(text: string | undefined): string {
  return createHash("sha1")
    .update(text ?? "deleted")
    .digest("hex")
    .slice(0, 12);
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
  const scanned = async () => (await scanFiles(cwd)).files.map((file) => file.path);
  const root = await rootToolchain(cwd);
  if (!(await isGitRepo(cwd))) return [...(await scanned()), ...root];
  const [tracked, untracked] = await Promise.all([
    gitPaths(cwd, ["ls-files", "--cached"]),
    untrackedFiles(cwd, ignoreMatcher(ignore)),
  ]);
  if (!tracked || !untracked) return [...(await scanned()), ...root];
  return [...new Set([...tracked, ...untracked, ...root])];
}

async function rootToolchain(cwd: string): Promise<string[]> {
  const found = await Promise.all(
    ROOT_TOOLCHAIN.map(async (name) =>
      (await lstat(absolute(cwd, name)).catch(() => undefined)) ? [name] : [],
    ),
  );
  return found.flat();
}
