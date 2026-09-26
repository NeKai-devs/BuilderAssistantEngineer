import { posix } from "node:path";
import { z } from "zod";
import type { Commands } from "../config/schema.js";
import { FormatError } from "../core/errors.js";
import { splitFrontmatter } from "../tasks/frontmatter.js";
import { findCycle } from "../tasks/graph.js";
import { withLogSection } from "../tasks/handoff.js";
import { parseTask, TASK_PATH, type Task, taskProblems } from "../tasks/schema.js";

export type PlanFile = { path: string; content: string };

const questionSchema = z.object({
  question: z.string().min(1),
  why: z.string().default(""),
  options: z.array(z.string()).optional(),
  blocking: z.boolean().optional(),
});

export type PlanQuestion = z.output<typeof questionSchema>;

const nullableCommand = z.string().nullish();

const configBlockSchema = z.object({
  commands: z.object({
    test: nullableCommand,
    lint: nullableCommand,
    typecheck: nullableCommand,
    build: nullableCommand,
  }),
});

export type ParsedPlan = {
  summary: string;
  questions: PlanQuestion[];
  commands: Commands;
  files: PlanFile[];
  tasks: Task[];
  warnings: string[];
};

export type ParseOptions = { knownTaskIds?: string[]; requireReviewer?: boolean };

type Block = { kind: "SUMMARY" | "QUESTIONS" | "CONFIG" | "FILE"; path: string; body: string };

export const MARKER =
  /^[ \t]*<<<(SUMMARY|QUESTIONS|CONFIG|END SUMMARY|END QUESTIONS|END CONFIG|END FILE|FILE:[^>\n]*)>>>/gm;
const MAX_PROBLEMS = 20;

const ALLOWED_PATHS = [
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^GEMINI\.md$/,
  /^docs\/plan\/[A-Za-z0-9._/-]+\.md$/,
  /^\.claude\/(agents|commands)\/[A-Za-z0-9._-]+\.md$/,
  /^\.opencode\/(agent|command)\/[A-Za-z0-9._-]+\.md$/,
];

const AGENT_PATH = /^\.(claude\/agents|opencode\/agent)\/[^/]+\.md$/;

export const PLAN_FORMAT = [
  "Emit only these blocks, nothing outside them. Paths are relative to the repo root.",
  "<<<SUMMARY>>>",
  "5-8 lines for the terminal",
  "<<<END SUMMARY>>>",
  "<<<QUESTIONS>>>",
  'JSON array of up to 5 objects {"question", "why", "options"?, "blocking"?}; [] if none',
  "<<<END QUESTIONS>>>",
  "<<<CONFIG>>>",
  '{"commands": {"test": "...", "lint": "...", "typecheck": "...", "build": "..."}} with null for commands the project will not have',
  "<<<END CONFIG>>>",
  "<<<FILE: path/to/file.md>>>",
  "full file content",
  "<<<END FILE>>>",
  "Allowed FILE paths: AGENTS.md, CLAUDE.md, GEMINI.md, docs/plan/**/*.md, docs/plan/tasks/T-NNN-slug.md,",
  ".claude/agents/*.md, .claude/commands/*.md, .opencode/agent/*.md, .opencode/command/*.md.",
  "Task files start with YAML frontmatter (id, title, status, phase, depends_on, size S|M|L,",
  "risk low|medium|high, tests required|optional) and contain the sections Goal, Context, Scope, Steps, Acceptance criteria,",
  "Verification (commands in a ```sh block, one per line), Risks and notes, and an empty Log.",
  "Subagent files start with YAML frontmatter that includes a description.",
].join("\n");

export function parsePlan(text: string, options: ParseOptions = {}): ParsedPlan {
  const problems: string[] = [];
  const warnings: string[] = [];
  const blocks = tokenize(text, problems, warnings);
  const summary = single(blocks, "SUMMARY", problems)?.body.trim() ?? "";
  if (summary === "" && problems.length === 0) problems.push("SUMMARY is empty");
  const questions = parseQuestions(single(blocks, "QUESTIONS", problems)?.body, problems);
  const commands = parseConfig(blocks, warnings);
  const files = collectFiles(blocks, problems).map((file) =>
    TASK_PATH.test(file.path) ? { ...file, content: withLogSection(file.content) } : file,
  );
  const tasks = validateTasks(files, options.knownTaskIds ?? [], problems);
  warnings.push(...missingTestPolicies(files));
  validateAgents(files, options.requireReviewer ?? false, problems);
  if (problems.length > 0) throw new FormatError(problems.slice(0, MAX_PROBLEMS).join("\n"));
  return { summary, questions, commands, files, tasks, warnings };
}

export function parseFileBlocks(text: string): PlanFile[] {
  const ignored: string[] = [];
  return collectFiles(tokenize(text, ignored, ignored), ignored);
}

export function renderPlan(plan: Omit<ParsedPlan, "tasks" | "warnings">): string {
  return [
    "<<<SUMMARY>>>",
    plan.summary,
    "<<<END SUMMARY>>>",
    "<<<QUESTIONS>>>",
    JSON.stringify(plan.questions),
    "<<<END QUESTIONS>>>",
    "<<<CONFIG>>>",
    JSON.stringify({ commands: plan.commands }),
    "<<<END CONFIG>>>",
    ...plan.files.flatMap((file) => [
      `<<<FILE: ${file.path}>>>`,
      file.content.trimEnd(),
      "<<<END FILE>>>",
    ]),
  ].join("\n");
}

function tokenize(text: string, problems: string[], warnings: string[]): Block[] {
  const blocks: Block[] = [];
  let open: { kind: Block["kind"]; path: string; end: number } | undefined;
  let outside = 0;
  let cursor = 0;
  for (const match of text.matchAll(MARKER)) {
    const marker = match[1] ?? "";
    const index = match.index ?? 0;
    if (!open) outside += text.slice(cursor, index).trim().length;
    cursor = index + match[0].length;
    if (marker.startsWith("END ")) {
      const kind = marker.slice(4);
      if (open?.kind !== kind) {
        problems.push(`<<<${marker}>>> without a matching opening marker`);
        continue;
      }
      blocks.push({
        kind: open.kind,
        path: open.path,
        body: stripEdges(text.slice(open.end, index)),
      });
      open = undefined;
      continue;
    }
    if (open) {
      problems.push(
        `<<<${marker}>>> opened before <<<END ${open.kind}>>> of ${open.path || open.kind}`,
      );
      continue;
    }
    const kind = marker.startsWith("FILE:") ? "FILE" : (marker as Block["kind"]);
    open = { kind, path: marker.startsWith("FILE:") ? marker.slice(5).trim() : "", end: cursor };
  }
  if (open) problems.push(`${open.path || open.kind} is missing <<<END ${open.kind}>>>`);
  else outside += text.slice(cursor).trim().length;
  if (outside > 0) warnings.push(`ignored ${outside} characters outside the output blocks`);
  return blocks;
}

function single(blocks: Block[], kind: "SUMMARY" | "QUESTIONS", problems: string[]) {
  const found = blocks.filter((block) => block.kind === kind);
  if (found.length !== 1)
    problems.push(`expected exactly one ${kind} block, found ${found.length}`);
  return found[0];
}

function parseQuestions(body: string | undefined, problems: string[]): PlanQuestion[] {
  if (body === undefined) return [];
  const json = unfence(body);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    problems.push(
      `QUESTIONS is not valid JSON (${error instanceof Error ? error.message : error})`,
    );
    return [];
  }
  const result = z.array(questionSchema).max(5).safeParse(data);
  if (result.success) return result.data;
  problems.push(`QUESTIONS does not match the schema (${z.prettifyError(result.error)})`);
  return [];
}

function parseConfig(blocks: Block[], warnings: string[]): Commands {
  const found = blocks.filter((block) => block.kind === "CONFIG");
  if (found.length > 1) warnings.push("ignored every CONFIG block after the first");
  const body = found[0]?.body;
  if (body === undefined) return {};
  let data: unknown;
  try {
    data = JSON.parse(unfence(body));
  } catch {
    warnings.push("ignored the CONFIG block: it is not valid JSON");
    return {};
  }
  const result = configBlockSchema.safeParse(data);
  if (!result.success) {
    warnings.push("ignored the CONFIG block: it does not match the schema");
    return {};
  }
  const commands: Commands = {};
  for (const [key, value] of Object.entries(result.data.commands)) {
    if (value?.trim()) commands[key as keyof Commands] = value.trim();
  }
  return commands;
}

function unfence(body: string): string {
  return body
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```$/, "");
}

function collectFiles(blocks: Block[], problems: string[]): PlanFile[] {
  const files: PlanFile[] = [];
  const seen = new Set<string>();
  for (const block of blocks.filter((candidate) => candidate.kind === "FILE")) {
    const path = normalizePath(block.path, problems);
    if (!path) continue;
    if (seen.has(path)) problems.push(`${path} appears more than once`);
    seen.add(path);
    files.push({ path, content: `${block.body.trimEnd()}\n` });
  }
  if (!seen.has("AGENTS.md")) problems.push("missing FILE block for AGENTS.md");
  return files;
}

function normalizePath(raw: string, problems: string[]): string | undefined {
  const path = raw.replace(/^\.\//, "");
  const unsafe =
    path === "" || path.includes("\\") || posix.isAbsolute(path) || path.split("/").includes("..");
  if (unsafe || !ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
    problems.push(`FILE path not allowed: "${raw}"`);
    return undefined;
  }
  return path;
}

function validateTasks(files: PlanFile[], knownIds: string[], problems: string[]): Task[] {
  const tasks: Task[] = [];
  for (const file of files.filter((candidate) => candidate.path.startsWith("docs/plan/tasks/"))) {
    const fileId = TASK_PATH.exec(file.path)?.[1];
    if (!fileId) {
      problems.push(`${file.path}: task files must be named docs/plan/tasks/T-NNN-slug.md`);
      continue;
    }
    try {
      const task = parseTask(file.path, file.content);
      if (task.meta.id !== fileId)
        problems.push(`${file.path}: frontmatter id ${task.meta.id} does not match the file name`);
      problems.push(...taskProblems(task));
      tasks.push(task);
    } catch (error) {
      if (!(error instanceof FormatError)) throw error;
      problems.push(error.message);
    }
  }
  validateGraph(tasks, knownIds, problems);
  return tasks;
}

function missingTestPolicies(files: PlanFile[]): string[] {
  return files
    .filter((file) => TASK_PATH.test(file.path))
    .filter((file) => safeFrontmatter(file.content)?.data.tests === undefined)
    .map((file) => `${file.path}: no tests field in the frontmatter; assuming optional`);
}

function validateGraph(tasks: Task[], knownIds: string[], problems: string[]): void {
  const ids = tasks.map((task) => task.meta.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  for (const id of new Set(duplicates)) problems.push(`task id ${id} is used more than once`);
  const known = new Set([...ids, ...knownIds]);
  for (const task of tasks) {
    const unknown = task.meta.depends_on.filter((id) => !known.has(id));
    if (unknown.length > 0)
      problems.push(`${task.meta.id} depends on unknown tasks: ${unknown.join(", ")}`);
  }
  const cycle = findCycle(
    tasks.map((task) => ({ id: task.meta.id, dependsOn: task.meta.depends_on })),
  );
  if (cycle) problems.push(`dependency cycle: ${cycle.join(" -> ")}`);
}

function validateAgents(files: PlanFile[], requireReviewer: boolean, problems: string[]): void {
  const agents = files.filter((file) => AGENT_PATH.test(file.path));
  for (const agent of agents) {
    const description = safeFrontmatter(agent.content)?.data.description;
    if (typeof description !== "string" || description.trim() === "") {
      problems.push(`${agent.path}: frontmatter must include a description`);
    }
  }
  if (requireReviewer && !agents.some((agent) => /review/i.test(posix.basename(agent.path)))) {
    problems.push("missing the reviewer subagent (a file whose name contains 'review')");
  }
}

function safeFrontmatter(text: string) {
  try {
    return splitFrontmatter(text);
  } catch {
    return undefined;
  }
}

function stripEdges(text: string): string {
  return text.replace(/^[ \t]*\r?\n/, "").replace(/\r?\n[ \t]*$/, "");
}
