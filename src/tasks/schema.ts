import { z } from "zod";
import { FormatError } from "../core/errors.js";
import { splitFrontmatter } from "./frontmatter.js";

export const TASK_STATUSES = ["pending", "in_progress", "done", "blocked"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TEST_POLICIES = ["required", "optional", "fix"] as const;

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
  const missing = (Object.keys(SECTIONS) as SectionKey[]).filter(
    (key) => sectionText(task.body, key) === undefined,
  );
  const problems = missing.map((key) => `${task.path}: missing section "${SECTIONS[key][0]}"`);
  if (!missing.includes("verification") && verificationCommands(task.body).length === 0) {
    problems.push(`${task.path}: Verification needs at least one command in a \`\`\`sh block`);
  }
  return problems;
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

export function verificationCommands(body: string): string[] {
  const section = sectionText(body, "verification") ?? "";
  return Array.from(section.matchAll(COMMAND_BLOCK), (match) => match[1] ?? "")
    .flatMap((block) => block.split(/\r?\n/))
    .map((line) => line.trim().replace(/^\$\s+/, ""))
    .filter((line) => line !== "" && !line.startsWith("#"));
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
