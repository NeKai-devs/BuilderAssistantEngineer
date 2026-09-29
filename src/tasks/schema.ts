import { z } from "zod";
import { FormatError } from "../core/errors.js";
import { allowlistProblems, type CheckProblem, trivialityProblems } from "./checks.js";
import { splitFrontmatter } from "./frontmatter.js";
import { logicalLines } from "./shell-words.js";

export const TASK_STATUSES = ["pending", "in_progress", "done", "blocked", "needs_review"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TEST_POLICIES = ["required", "optional", "fix"] as const;
export const COMMIT_TYPES = ["feat", "fix", "refactor", "test", "docs", "chore"] as const;

export const TASK_ID = /^T-\d{3,}$/;
export const TASK_PATH = /^docs\/plan\/tasks\/(T-\d{3,})-[A-Za-z0-9._-]+\.md$/;
export const TASKS_DIR = "docs/plan/tasks";

const taskId = z.string().regex(TASK_ID, "must look like T-001");

export const taskMetaSchema = z.object({
  id: taskId,
  title: z.string().min(1),
  status: z.enum(TASK_STATUSES),
  phase: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/).transform(Number)]),
  depends_on: z
    .array(taskId)
    .nullish()
    .transform((value) => value ?? []),
  size: z.enum(["S", "M", "L"]),
  risk: z.enum(["low", "medium", "high"]),
  tests: z.enum(TEST_POLICIES).default("optional"),
  type: z.enum(COMMIT_TYPES).default("chore"),
  review_note: z.string().optional(),
});

export type TaskMeta = z.output<typeof taskMetaSchema>;
export type Task = { path: string; meta: TaskMeta; body: string; text: string };

export const SECTIONS = {
  goal: ["goal", "objetivo"],
  context: ["context", "contexto"],
  scope: ["scope", "alcance"],
  steps: ["steps", "pasos"],
  acceptance: ["acceptance criteria", "criterios de aceptación", "criterios de aceptacion"],
  verification: ["verification", "verificación", "verificacion"],
  risks: ["risks and notes", "riesgos y notas", "risks", "riesgos"],
  log: ["log", "registro", "bitácora", "bitacora"],
} as const;

export type SectionKey = keyof typeof SECTIONS;

const TRIVIALITY: Record<string, string> = {
  masks:
    "hides failures (|| true, set +e); the block runs with set -euo pipefail and must fail when a check fails",
  trivial:
    "runs nothing that checks the task; use the project's test runner, a linter or a check with an expected result (test -f, grep -q, curl -f)",
};

const UNATTENDED =
  "runs a command that bae does not run when nobody confirms it; use a known runner or check (package managers, language toolchains and the repository's .venv, test runners, linters, make, read-only git, test, grep, diff, curl, jq), run project scripts with `sh script.sh` or `node script.js` rather than by path, send data with curl only to a local server, and avoid inline code (`node -e`, `python -c`), `$( )`, `eval` and nested shells";

const COMMAND_BLOCK = /```(?:sh|bash|shell|console)[^\n]*\n([\s\S]*?)```/g;

export function parseTask(path: string, text: string): Task {
  const frontmatter = readFrontmatter(path, text);
  const result = taskMetaSchema.safeParse(frontmatter.data);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "frontmatter"}: ${issue.message}`)
      .join("; ");
    throw new FormatError(`${path}: invalid frontmatter (${details})`);
  }
  return { path, meta: result.data, body: frontmatter.body, text };
}

export function taskProblems(task: Task): string[] {
  return [
    ...sectionProblems(task),
    ...verificationNotes(task).map((note) => `${task.path}: ${note}`),
  ];
}

export function sectionProblems(task: Task): string[] {
  return (Object.keys(SECTIONS) as SectionKey[])
    .filter((key) => sectionText(task.body, key) === undefined)
    .map((key) => `${task.path}: missing section "${SECTIONS[key][0]}"`);
}

export function verificationNotes(task: Task, allow?: string[]): string[] {
  if (sectionText(task.body, "verification") === undefined) return [];
  const notes =
    verificationCommands(task.body).length === 0
      ? ["Verification needs at least one command in a ```sh block"]
      : [];
  const script = verificationScript(task.body);
  for (const problem of trivialityProblems(script)) {
    notes.push(`Verification ${TRIVIALITY[problem.reason]}: ${problem.command}`);
  }
  for (const problem of allow ? allowlistProblems(script, allow) : []) {
    notes.push(`Verification ${unattendedNote(problem)}`);
  }
  return notes;
}

export function unattendedNote(problem: CheckProblem): string {
  return `${UNATTENDED}: ${problem.command}`;
}

export function sectionText(body: string, key: SectionKey): string | undefined {
  return sectionTexts(body, key)[0];
}

export function sectionTexts(body: string, key: SectionKey): string[] {
  const aliases: readonly string[] = SECTIONS[key];
  const parts = body.split(/^##[ \t]+(.+?)[ \t]*$/m);
  const found: string[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const heading = (parts[index] ?? "").trim().toLowerCase();
    if (aliases.includes(heading)) found.push((parts[index + 1] ?? "").trim());
  }
  return found;
}

export function verificationScript(body: string): string[] {
  const section = sectionText(body, "verification") ?? "";
  return Array.from(section.matchAll(COMMAND_BLOCK), (match) => match[1] ?? "")
    .flatMap((block) => block.replace(/\r?\n$/, "").split(/\r?\n/))
    .map((line) => line.replace(/^(\s*)\$\s+/, "$1"));
}

export function verificationCommands(body: string): string[] {
  return logicalLines(verificationScript(body));
}

function readFrontmatter(path: string, text: string) {
  try {
    const frontmatter = splitFrontmatter(text);
    if (frontmatter) return frontmatter;
  } catch (error) {
    const details = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new FormatError(`${path}: frontmatter is not valid YAML (${details})`);
  }
  throw new FormatError(`${path}: missing YAML frontmatter`);
}
