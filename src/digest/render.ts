import type { Mode } from "../config/schema.js";
import { BASELINE_CHECKS, type Baseline } from "./baseline.js";
import { type Block, renderBlock } from "./budget.js";
import { isLockfile, languageOf } from "./files.js";
import { codeFence, formatBytes } from "./format.js";
import type { GitInfo } from "./git.js";
import type { Manifest } from "./manifests.js";
import type { TodoCount } from "./todos.js";
import { renderTree } from "./tree.js";
import type { Scan } from "./walk.js";

export type Facts = {
  name: string;
  mode: Mode;
  scan: Scan;
  manifests: Manifest[];
  frameworks: string[];
  packageManagers: string[];
  baseline: Baseline;
  entryPoints: string[];
  docs: string[];
  configs: string[];
  git: GitInfo | undefined;
  todos: TodoCount;
  treeDepth: number;
};

const LANGUAGE_ROWS = 12;
const LARGEST_FILES = 10;
const BRANCH_LIMIT = 20;
const OMITTED_LIMIT = 50;

export function renderHead(facts: Facts): string {
  return [
    renderSummary(facts),
    renderBaseline(facts.baseline),
    renderLanguages(facts.scan),
    list("Entry points", facts.entryPoints),
    list("Configs", facts.configs),
    list("Docs", facts.docs),
    `## Tree (depth ${facts.treeDepth})\n\n${renderFileTree(facts)}`,
    renderGit(facts.git),
    renderTodos(facts.todos),
    renderLargest(facts.scan),
  ].join("\n\n");
}

export function renderContents(blocks: Block[]): string {
  let group = "";
  let text = "";
  for (const block of blocks) {
    if (block.group !== group) {
      group = block.group;
      text += `## ${group}\n\n`;
    }
    text += renderBlock(block);
  }
  return text;
}

export function renderOmitted(paths: string[]): string {
  if (paths.length === 0) return "";
  const shown = paths.slice(0, OMITTED_LIMIT).map((path) => `- ${path}`);
  const extra = paths.length - OMITTED_LIMIT;
  const more = extra > 0 ? [`- … ${extra} more`] : [];
  return [
    "## Omitted for budget",
    "",
    "Not included above; read them directly if needed.",
    "",
    ...shown,
    ...more,
    "",
  ].join("\n");
}

function renderSummary(facts: Facts): string {
  const bytes = facts.scan.files.reduce((sum, file) => sum + file.size, 0);
  const truncated = facts.scan.truncated ? ` (scan stopped at ${facts.scan.files.length})` : "";
  return [
    "# Repository digest",
    "",
    `- Root: ${facts.name}`,
    `- Mode: ${facts.mode}`,
    `- Files: ${facts.scan.files.length} (${formatBytes(bytes)})${truncated}`,
    `- Manifests: ${joinOrNone(facts.manifests.map((manifest) => manifest.path))}`,
    `- Package managers: ${joinOrNone(facts.packageManagers)}`,
    `- Frameworks: ${joinOrNone(facts.frameworks)}`,
  ].join("\n");
}

function renderBaseline(baseline: Baseline): string {
  const rows = BASELINE_CHECKS.map((check) => {
    const evidence = baseline[check];
    return evidence.length > 0
      ? `- ${check}: present — ${evidence.join("; ")}`
      : `- ${check}: absent`;
  });
  return ["## Baseline", "", ...rows].join("\n");
}

function renderLanguages(scan: Scan): string {
  const totals = new Map<string, { files: number; bytes: number }>();
  for (const file of scan.files) {
    const language = languageOf(file.path);
    if (!language) continue;
    const total = totals.get(language) ?? { files: 0, bytes: 0 };
    totals.set(language, { files: total.files + 1, bytes: total.bytes + file.size });
  }
  if (totals.size === 0) return "## Languages\n\nNo source files.";
  const rows = [...totals.entries()]
    .sort(([, a], [, b]) => b.bytes - a.bytes)
    .slice(0, LANGUAGE_ROWS)
    .map(([language, total]) => `| ${language} | ${total.files} | ${formatBytes(total.bytes)} |`);
  return ["## Languages", "", "| Language | Files | Size |", "| --- | --- | --- |", ...rows].join(
    "\n",
  );
}

function renderFileTree(facts: Facts): string {
  const paths = facts.scan.files.map((file) => file.path);
  return paths.length > 0 ? codeFence(renderTree(paths, facts.treeDepth), "text") : "Empty.";
}

function renderGit(git: GitInfo | undefined): string {
  if (!git) return "## Git\n\nNot a git repository.";
  const extra = git.branches.length - BRANCH_LIMIT;
  const branches =
    git.branches.slice(0, BRANCH_LIMIT).join(", ") + (extra > 0 ? ` (+${extra})` : "");
  return [
    "## Git",
    "",
    `- Branch: ${git.branch || "(detached)"}`,
    `- Branches: ${branches || "none"}`,
    `- Uncommitted changes: ${git.changes} files`,
    "- Recent commits:",
    ...(git.commits.length > 0 ? git.commits.map((commit) => `  - ${commit}`) : ["  - none"]),
  ].join("\n");
}

function renderTodos(todos: TodoCount): string {
  if (todos.total === 0) return "## TODO/FIXME\n\nNone found.";
  const tags = Object.entries(todos.byTag)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .map(([tag, count]) => `${tag} ${count}`)
    .join(", ");
  const files = todos.files.map(([path, count]) => `${path} (${count})`).join(", ");
  return ["## TODO/FIXME", "", `- Total: ${todos.total} (${tags})`, `- Top files: ${files}`].join(
    "\n",
  );
}

function renderLargest(scan: Scan): string {
  const largest = scan.files
    .filter((file) => !isLockfile(file.path))
    .sort((a, b) => b.size - a.size)
    .slice(0, LARGEST_FILES)
    .map((file) => `- ${file.path} — ${formatBytes(file.size)}`);
  return ["## Largest files", "", ...(largest.length > 0 ? largest : ["None."])].join("\n");
}

function list(title: string, items: string[]): string {
  return [
    `## ${title}`,
    "",
    ...(items.length > 0 ? items.map((item) => `- ${item}`) : ["None found."]),
  ].join("\n");
}

function joinOrNone(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "none";
}
