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

type RepoIndex = { names: Set<string>; roots: Set<string> };

const CODE_SPAN = /`([^`\n]+)`([ \t]*\((?:new|nuevo|nueva)\))?/gi;
const NEW_INSIDE = /^(.+?)\s+\((?:new|nuevo|nueva)\)$/i;
const PATH_TOKEN = /^(?:\.\/)?([\w@.-]+(?:\/[\w@.[\]()-]+)*)\/?(?::(\d+)(?:-(\d+))?)?$/;
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
  ".env",
]);

export async function findUnverified(cwd: string, parsed: ParsedPlan): Promise<Unverified[]> {
  const repo = await indexRepo(cwd);
  const planned = plannedPaths(parsed.files);
  const roots = new Set([...repo.roots, ...[...planned].map((path) => path.split("/")[0] ?? "")]);
  const found: Unverified[] = [];
  const seen = new Set<string>();
  for (const { source, text } of evidenceSources(parsed)) {
    for (const citation of extractCitations(text, source, roots)) {
      const key = `${source}|${citation.path}|${citation.line ?? ""}|${citation.endLine ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const problem = await verify(cwd, citation, repo, planned);
      if (problem) found.push(problem);
    }
  }
  return found;
}

export function evidenceSources(parsed: ParsedPlan): { source: string; text: string }[] {
  return [
    ...parsed.files
      .filter((file) => EVIDENCE_FILES.some((pattern) => pattern.test(file.path)))
      .map((file) => ({ source: file.path, text: file.content })),
    ...parsed.tasks.map((task) => ({
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
  const line = match[2] ? Number(match[2]) : undefined;
  const endLine = match[3] ? Number(match[3]) : undefined;
  const checked =
    segments.length === 1
      ? KNOWN_FILES.has(path) || (line !== undefined && hasFileExtension(path))
      : hasFileExtension(path) || roots.has(first);
  if (!checked) return undefined;
  return { text: span, path, ...(line ? { line } : {}), ...(endLine ? { endLine } : {}) };
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
): Promise<Unverified | undefined> {
  const bare = !citation.path.includes("/");
  const info = await stat(join(cwd, ...citation.path.split("/"))).catch(() => undefined);
  if (citation.line) {
    if (!info?.isFile()) return bare && repo.names.has(citation.path) ? undefined : citation;
    const text = (await readTextIfExists(join(cwd, ...citation.path.split("/")))) ?? "";
    const lines = text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
    return (citation.endLine ?? citation.line) <= lines ? undefined : { ...citation, lines };
  }
  if (info || (bare && repo.names.has(citation.path))) return undefined;
  const isPlanned =
    planned.has(citation.path) ||
    [...planned].some(
      (path) => path.startsWith(`${citation.path}/`) || (bare && baseName(path) === citation.path),
    );
  return isPlanned ? undefined : citation;
}

async function indexRepo(cwd: string): Promise<RepoIndex> {
  const { files } = await scanFiles(cwd);
  return {
    names: new Set(files.map((file) => baseName(file.path))),
    roots: new Set(files.map((file) => file.path.split("/")[0] ?? "")),
  };
}
