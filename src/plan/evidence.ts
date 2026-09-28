import { stat } from "node:fs/promises";
import { join } from "node:path";
import { readTextIfExists } from "../core/fs.js";
import { baseName, extensionOf, languageOf } from "../digest/files.js";
import { scanFiles } from "../digest/walk.js";
import { sectionText } from "../tasks/schema.js";
import type { ParsedPlan, PlanFile } from "./parser.js";

export type Citation = {
  source: string;
  text: string;
  path: string;
  line?: number;
  endLine?: number;
};
export type Unverified = Citation & { lines?: number };

type RepoIndex = { names: Map<string, string[]>; roots: Set<string> };

const CODE_SPAN = /`([^`\n]+)`([ \t]*\((?:new|nuevo|nueva)\))?/gi;
const NEW_INSIDE = /^(.+?)\s+\((?:new|nuevo|nueva)\)$/i;
const PATH_TOKEN =
  /^(?:\.\/)?([\w@.-]+(?:\/[\w@.[\]()-]+)*)\/?(?::(\d+)(?::\d+)?(?:-(\d+))?|#L(\d+)(?:-L?(\d+))?)?$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const EVIDENCE_FILES = [
  /^docs\/plan\/02-architecture\.md$/,
  /^docs\/plan\/03-decisions\/[^/]+\.md$/,
];

const EXTENSIONS = new Set(
  "md mdx json jsonc yaml yml toml ini cfg conf env txt lock xml gradle mod sum csv properties example sample template tmpl mk"
    .split(" ")
    .map((extension) => `.${extension}`),
);

const GENERATED_ROOTS = new Set([
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "node_modules",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".nuxt",
]);

const KNOWN_FILES = new Set([
  "Dockerfile",
  "Makefile",
  "Procfile",
  "Jenkinsfile",
  "Gemfile",
  "Rakefile",
  "LICENSE",
  "README.md",
  "CHANGELOG.md",
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "go.mod",
  "go.sum",
  "Cargo.toml",
  "composer.json",
  "pom.xml",
  "build.gradle",
  ".env.example",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".dockerignore",
  ".nvmrc",
  ".npmrc",
  ".python-version",
  ".tool-versions",
]);

const TS_SOURCES: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};
const MAX_BARE_CANDIDATES = 20;

export type PlanEvidence = Pick<ParsedPlan, "files" | "tasks">;
export type EvidenceCheck = { checked: number; unverified: Unverified[] };

export async function findUnverified(cwd: string, plan: PlanEvidence): Promise<Unverified[]> {
  return (await checkCitations(cwd, plan)).unverified;
}

export async function checkCitations(cwd: string, plan: PlanEvidence): Promise<EvidenceCheck> {
  const repo = await indexRepo(cwd);
  const planned = plannedPaths(plan.files);
  const written = new Map([
    ...plan.files.map((file) => [file.path, file.content] as const),
    ...plan.tasks.map((task) => [task.path, task.text] as const),
  ]);
  const roots = new Set([...repo.roots, ...[...planned].map((path) => path.split("/")[0] ?? "")]);
  const unverified: Unverified[] = [];
  const seen = new Set<string>();
  for (const { source, text } of evidenceSources(plan)) {
    for (const citation of extractCitations(text, source, roots)) {
      const key = `${source}|${citation.path}|${citation.line ?? ""}|${citation.endLine ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const problem = await verify(cwd, citation, repo, planned, written);
      if (problem) unverified.push(problem);
    }
  }
  return { checked: seen.size, unverified };
}

export function evidenceSources(plan: PlanEvidence): { source: string; text: string }[] {
  return [
    ...plan.files
      .filter((file) => EVIDENCE_FILES.some((pattern) => pattern.test(file.path)))
      .map((file) => ({ source: file.path, text: file.content })),
    ...plan.tasks.map((task) => ({
      source: task.path,
      text: sectionText(task.body, "context") ?? "",
    })),
  ];
}

export function extractCitations(text: string, source: string, roots: Set<string>): Citation[] {
  const citations: Citation[] = [];
  for (const match of text.matchAll(CODE_SPAN)) {
    const span = (match[1] ?? "").trim();
    if (match[2] || NEW_INSIDE.test(span)) continue;
    const citation = toCitation(span, roots);
    if (citation) citations.push({ source, ...citation });
  }
  return citations;
}

export function plannedPaths(files: PlanFile[]): Set<string> {
  const planned = new Set(files.map((file) => file.path));
  for (const file of files) {
    for (const match of file.content.matchAll(CODE_SPAN)) {
      const span = (match[1] ?? "").trim();
      const inside = NEW_INSIDE.exec(span)?.[1];
      const path = normalize(match[2] ? span : inside);
      if (path) planned.add(path);
    }
  }
  return planned;
}

export function describeUnverified(item: Unverified): string {
  const detail = item.lines === undefined ? "" : ` (the file has ${item.lines} lines)`;
  return `\`${item.text}\` in ${item.source}${detail}`;
}

function toCitation(span: string, roots: Set<string>): Omit<Citation, "source"> | undefined {
  if (/[\s*$<>{}|]|:\/\//.test(span)) return undefined;
  const match = PATH_TOKEN.exec(span);
  const path = match?.[1];
  if (!match || !path) return undefined;
  const segments = path.split("/");
  const first = segments[0] ?? "";
  const skipped =
    segments.some((segment) => segment === "." || segment === "..") ||
    GENERATED_ROOTS.has(first) ||
    (segments.length > 1 && DOMAIN.test(first));
  if (skipped) return undefined;
  const start = match[2] ?? match[4];
  const end = match[3] ?? match[5];
  const line = start ? Number(start) : undefined;
  const endLine = end ? Number(end) : undefined;
  const checked =
    segments.length === 1
      ? KNOWN_FILES.has(path) || (line !== undefined && hasFileExtension(path))
      : hasFileExtension(path) || roots.has(first);
  if (!checked) return undefined;
  return {
    text: span,
    path,
    ...(line !== undefined ? { line } : {}),
    ...(endLine !== undefined ? { endLine } : {}),
  };
}

function hasFileExtension(path: string): boolean {
  return languageOf(path) !== undefined || EXTENSIONS.has(extensionOf(path));
}

function normalize(span: string | undefined): string | undefined {
  const path = span
    ?.replace(/^\.\//, "")
    .replace(/\/$/, "")
    .replace(/:\d+(-\d+)?$/, "");
  return path && !/\s/.test(path) ? path : undefined;
}

async function verify(
  cwd: string,
  citation: Citation,
  repo: RepoIndex,
  planned: Set<string>,
  written: Map<string, string>,
): Promise<Unverified | undefined> {
  const bare = !citation.path.includes("/");
  const own = written.get(citation.path);
  if (citation.line !== undefined && own !== undefined) {
    const lines = own.split(/\r?\n/).length - (own.endsWith("\n") ? 1 : 0);
    const last = citation.endLine ?? citation.line;
    return citation.line >= 1 && last >= citation.line && last <= lines
      ? undefined
      : { ...citation, lines };
  }
  if (citation.line !== undefined) return verifyLines(cwd, citation, repo, bare);
  const path = await existing(cwd, citation.path);
  if (path || (bare && repo.names.has(citation.path))) return undefined;
  const isPlanned =
    planned.has(citation.path) ||
    [...planned].some(
      (item) => item.startsWith(`${citation.path}/`) || (bare && baseName(item) === citation.path),
    );
  return isPlanned ? undefined : citation;
}

async function verifyLines(
  cwd: string,
  citation: Citation,
  repo: RepoIndex,
  bare: boolean,
): Promise<Unverified | undefined> {
  const line = citation.line ?? 0;
  const last = citation.endLine ?? line;
  if (line < 1 || last < line) return citation;
  const direct = await existing(cwd, citation.path);
  const candidates = direct
    ? [direct]
    : bare
      ? (repo.names.get(citation.path) ?? []).slice(0, MAX_BARE_CANDIDATES)
      : [];
  if (candidates.length === 0) return citation;
  const counts = await Promise.all(candidates.map((path) => lineCount(cwd, path)));
  const lines = Math.max(...counts);
  return last <= lines ? undefined : { ...citation, lines };
}

async function existing(cwd: string, path: string): Promise<string | undefined> {
  for (const candidate of [path, ...sourceAlternatives(path)]) {
    if (await stat(join(cwd, ...candidate.split("/"))).catch(() => undefined)) return candidate;
  }
  return undefined;
}

function sourceAlternatives(path: string): string[] {
  const extension = extensionOf(path);
  const stem = path.slice(0, path.length - extension.length);
  return (TS_SOURCES[extension] ?? []).map((replacement) => `${stem}${replacement}`);
}

async function lineCount(cwd: string, path: string): Promise<number> {
  const target = join(cwd, ...path.split("/"));
  if (!(await stat(target).catch(() => undefined))?.isFile()) return 0;
  const text = (await readTextIfExists(target)) ?? "";
  return text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
}

async function indexRepo(cwd: string): Promise<RepoIndex> {
  const { files } = await scanFiles(cwd);
  const names = new Map<string, string[]>();
  for (const file of files) {
    const name = baseName(file.path);
    names.set(name, [...(names.get(name) ?? []), file.path]);
  }
  return { names, roots: new Set(files.map((file) => file.path.split("/")[0] ?? "")) };
}
