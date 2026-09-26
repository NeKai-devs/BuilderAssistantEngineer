import { rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type Config, configSchema } from "../config/schema.js";
import { readTextIfExists, writeText } from "../core/fs.js";
import { flaggedFiles, headCommit, isGitRepo } from "../core/git.js";
import { BAE_DIR } from "../core/paths.js";
import { loadPrompt, type Prompt } from "../core/prompt-loader.js";
import { repoState } from "../core/state.js";
import { findReviewer } from "../review/reviewer.js";
import { scopePaths } from "../review/scope.js";
import { hashPaths, takeSnapshot } from "../review/snapshot.js";
import { runDir } from "../tasks/runs.js";
import type { Task } from "../tasks/schema.js";
import { verificationCommands } from "../tasks/schema.js";
import { collectProtected, TASKS_DIR } from "./contract.js";
import { captureIgnore } from "./ignore-rules.js";
import { suiteBaselineSchema, suiteCommands } from "./regression.js";

export const CAPTURED_PROMPTS = ["review", "retry", "lesson", "fix-format"] as const;
export type CapturedPrompt = (typeof CAPTURED_PROMPTS)[number];

const promptSchema = z.object({ path: z.string(), text: z.string() });

const captureSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  path: z.string(),
  takenAt: z.string(),
  git: z.boolean(),
  base: z.string().optional(),
  snapshot: z.record(z.string(), z.string().nullable()),
  ignore: z.array(z.object({ dir: z.string(), text: z.string() })),
  config: configSchema,
  task: z.string(),
  prompts: z.object({
    review: promptSchema,
    retry: promptSchema,
    lesson: promptSchema,
    "fix-format": promptSchema,
  }),
  reviewer: z.string(),
  agentsMd: z.string().optional(),
  protected: z.record(z.string(), z.string()),
  shadows: z.array(z.string()).default([]),
  flagged: z.array(z.string()).default([]),
  baseline: suiteBaselineSchema.optional(),
  skips: z.array(z.string()).default([]),
  late: z.boolean().optional(),
  finished: z.boolean().optional(),
});

export type Capture = z.output<typeof captureSchema>;

const CAPTURE_FILE = "capture.json";
const ACTIVE_FILE = "active.json";
const AGENTS_MD = "AGENTS.md";

export async function prepareCapture(cwd: string, config: Config, task: Task): Promise<Capture> {
  const previous = await readCapture(cwd, task.meta.id);
  const reuse = previous && !previous.finished ? previous : undefined;
  const fixed = reuse
    ? {
        takenAt: reuse.takenAt,
        git: reuse.git,
        base: reuse.base,
        snapshot: reuse.snapshot,
        ignore: reuse.ignore,
        baseline: reuse.baseline,
        skips: reuse.skips,
        late: reuse.late,
      }
    : await captureFixed(cwd);
  return {
    version: 1,
    id: task.meta.id,
    path: task.path,
    ...fixed,
    ...(await captureContract(cwd, config, task)),
  };
}

export async function readCapture(cwd: string, id: string): Promise<Capture | undefined> {
  const text = await readTextIfExists(join(runDir(cwd, id), CAPTURE_FILE));
  if (text === undefined) return undefined;
  try {
    const result = captureSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export async function saveCapture(cwd: string, capture: Capture): Promise<void> {
  const path = join(runDir(cwd, capture.id), CAPTURE_FILE);
  await writeText(path, `${JSON.stringify(capture, null, 2)}\n`);
}

export async function markActive(cwd: string, id: string): Promise<void> {
  await writeText(join(repoState(cwd), ACTIVE_FILE), `${JSON.stringify({ id })}\n`);
}

export async function clearActive(cwd: string): Promise<void> {
  await rm(join(repoState(cwd), ACTIVE_FILE), { force: true });
}

export async function readActive(cwd: string): Promise<string | undefined> {
  const text = await readTextIfExists(join(repoState(cwd), ACTIVE_FILE));
  try {
    const id = (JSON.parse(text ?? "") as { id?: unknown }).id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

export async function trustAgentsMd(cwd: string, capture: Capture, trusted: string): Promise<void> {
  const current = await readTextIfExists(join(cwd, AGENTS_MD));
  capture.agentsMd = trusted;
  if (current !== undefined) capture.protected[AGENTS_MD] = current;
  if (current === trusted) Object.assign(capture.snapshot, await hashPaths(cwd, [AGENTS_MD]));
  await saveCapture(cwd, capture);
}

export function capturedPrompt(capture: Capture, name: CapturedPrompt): Prompt {
  return capture.prompts[name];
}

async function captureFixed(cwd: string) {
  const git = await isGitRepo(cwd);
  const base = git ? await headCommit(cwd) : undefined;
  return {
    takenAt: new Date().toISOString(),
    git,
    ...(base ? { base } : {}),
    snapshot: await takeSnapshot(cwd, [BAE_DIR, TASKS_DIR]),
    ignore: git ? await captureIgnore(cwd) : [],
    skips: [] as string[],
  };
}

async function captureContract(cwd: string, config: Config, task: Task) {
  const prompts = await Promise.all(CAPTURED_PROMPTS.map((name) => loadPrompt(name, cwd)));
  const agentsMd = await readTextIfExists(join(cwd, AGENTS_MD));
  return {
    config,
    task: task.text,
    prompts: Object.fromEntries(
      CAPTURED_PROMPTS.map((name, index) => [name, prompts[index]]),
    ) as Capture["prompts"],
    reviewer: await findReviewer(cwd, config.backend),
    ...(agentsMd === undefined ? {} : { agentsMd }),
    ...(await collectProtected(cwd, {
      suite: suiteCommands(config).map((item) => item.command),
      verification: verificationCommands(task.body),
      own: scopePaths(task),
    })),
    flagged: (await flaggedFiles(cwd)) ?? [],
  };
}
