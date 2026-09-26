import { join } from "node:path";
import { readTextIfExists } from "../core/fs.js";
import type { PlanFile } from "../plan/parser.js";
import { setFrontmatterFields } from "../tasks/frontmatter.js";
import { type LoadedTask, loadTaskFiles } from "../tasks/load.js";
import { TASK_PATH } from "../tasks/schema.js";

export const MANAGED_BEGIN = "<!-- bae:begin -->";
export const MANAGED_END = "<!-- bae:end -->";

export type ChangeKind = "create" | "update" | "unchanged" | "keep" | "delete";
export type Change = { path: string; before: string | undefined; after: string; kind: ChangeKind };

const MANAGED_FILES = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);
const IMPORTING_FILES = new Set(["CLAUDE.md", "GEMINI.md"]);
const IMPORT_LINE = /^@AGENTS\.md[ \t]*$/m;
const CHANGELOG = "docs/plan/CHANGELOG.md";

export async function planChanges(cwd: string, files: PlanFile[]): Promise<Change[]> {
  const tasks = new Map((await loadTaskFiles(cwd)).map((task) => [task.id, task]));
  return Promise.all(files.map((file) => changeFor(cwd, file, tasks)));
}

export function mergeManaged(before: string | undefined, content: string, path: string): string {
  const block = (body: string) => `${MANAGED_BEGIN}\n${body.trim()}\n${MANAGED_END}`;
  const merged = (body: string) => {
    if (before === undefined) return `${block(body)}\n`;
    const start = before.indexOf(MANAGED_BEGIN);
    const end = before.indexOf(MANAGED_END);
    if (start !== -1 && end > start) {
      return before.slice(0, start) + block(body) + before.slice(end + MANAGED_END.length);
    }
    return `${before.trimEnd()}\n\n${block(body)}\n`;
  };
  const result = merged(content);
  if (!IMPORTING_FILES.has(path) || IMPORT_LINE.test(result)) return result;
  return merged(`@AGENTS.md\n\n${content.trim()}`);
}

async function changeFor(
  cwd: string,
  file: PlanFile,
  tasks: Map<string, LoadedTask>,
): Promise<Change> {
  const existing = tasks.get(TASK_PATH.exec(file.path)?.[1] ?? "");
  const path = existing?.path ?? file.path;
  const before = await readTextIfExists(join(cwd, ...path.split("/")));
  if (existing?.task?.meta.status === "done")
    return { path, before, after: before ?? "", kind: "keep" };
  const after = contentFor(file, before, existing);
  const kind = before === undefined ? "create" : before === after ? "unchanged" : "update";
  return { path, before, after, kind };
}

function contentFor(file: PlanFile, before: string | undefined, existing?: LoadedTask): string {
  if (MANAGED_FILES.has(file.path)) return mergeManaged(before, file.content, file.path);
  if (file.path === CHANGELOG) return prependChangelog(before, file.content);
  const status = existing?.task?.meta.status;
  return status ? setFrontmatterFields(file.content, { status }) : file.content;
}

function prependChangelog(before: string | undefined, content: string): string {
  if (!before || before.includes(content.trim())) return content;
  return `${content.trimEnd()}\n\n${before}`;
}
