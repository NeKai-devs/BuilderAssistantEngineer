import { stat } from "node:fs/promises";
import { join } from "node:path";
import { FormatError } from "../../src/core/errors.js";
import { readTextIfExists } from "../../src/core/fs.js";
import { checkCitations } from "../../src/plan/evidence.js";
import { logLines } from "../../src/tasks/handoff.js";
import { parseTask, sectionText, type Task, verificationCommands } from "../../src/tasks/schema.js";

export type Ratio = { hits: number; total: number };
export type Citation = { path: string; line?: number; endLine?: number };
export type ArtifactFile = { path: string; text: string };
export type PlanMetrics = {
  tasks: number;
  tasksWithVerification: Ratio;
  lineRefs: Ratio;
  paths: Ratio;
  claims: Ratio;
  testsRequired: Ratio;
  tasksWithLog: Ratio;
};

const CODE_SPAN = /`([^`\n]+)`/g;
const PATH_TOKEN = /^(?:\.\/)?([\w@.-]+(?:\/[\w@.[\]()-]+)*)\/?(?::(\d+)(?:-(\d+))?)?$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]*$/;

export async function measurePlan(repo: string, files: ArtifactFile[]): Promise<PlanMetrics> {
  const tasks = files.filter((file) => /^docs\/plan\/tasks\/[^/]+\.md$/.test(file.path));
  const verified = tasks.filter((task) => verificationCommands(task.text).length > 0).length;
  const citations = uniqueCitations(files.flatMap((file) => extractCitations(file.text)));
  const checks = await Promise.all(citations.map((citation) => citationExists(repo, citation)));
  const withLines = citations.flatMap((citation, index) => (citation.line ? [checks[index]] : []));
  const parsed = tasks.flatMap((task) => safeTask(task));
  const planFiles = files.map((file) => ({ path: file.path, content: file.text }));
  const evidence = await checkCitations(repo, { files: planFiles, tasks: parsed });
  return {
    tasks: tasks.length,
    tasksWithVerification: { hits: verified, total: tasks.length },
    lineRefs: { hits: withLines.filter(Boolean).length, total: withLines.length },
    paths: { hits: checks.filter(Boolean).length, total: checks.length },
    claims: { hits: evidence.checked - evidence.unverified.length, total: evidence.checked },
    testsRequired: {
      hits: parsed.filter((task) => task.meta.tests === "required").length,
      total: tasks.length,
    },
    tasksWithLog: {
      hits: parsed.filter(
        (task) => sectionText(task.body, "log") !== undefined && logLines(task).length === 0,
      ).length,
      total: tasks.length,
    },
  };
}

function safeTask(file: ArtifactFile): Task[] {
  try {
    return [parseTask(file.path, file.text)];
  } catch (error) {
    if (error instanceof FormatError) return [];
    throw error;
  }
}

export function extractCitations(text: string): Citation[] {
  return Array.from(text.matchAll(CODE_SPAN), (match) =>
    toCitation((match[1] ?? "").trim()),
  ).filter((citation): citation is Citation => citation !== undefined);
}

export async function citationExists(repo: string, citation: Citation): Promise<boolean> {
  const target = join(repo, ...citation.path.split("/"));
  const info = await stat(target).catch(() => undefined);
  if (!info) return false;
  if (!citation.line) return true;
  if (!info.isFile()) return false;
  const lines = ((await readTextIfExists(target)) ?? "").split(/\r?\n/).length;
  return (citation.endLine ?? citation.line) <= lines;
}

export function formatRatio(ratio: Ratio): string {
  if (ratio.total === 0) return "n/a";
  return `${ratio.hits}/${ratio.total} (${Math.round((ratio.hits / ratio.total) * 100)}%)`;
}

export function sumRatios(ratios: Ratio[]): Ratio {
  return ratios.reduce(
    (sum, ratio) => ({ hits: sum.hits + ratio.hits, total: sum.total + ratio.total }),
    {
      hits: 0,
      total: 0,
    },
  );
}

function toCitation(span: string): Citation | undefined {
  if (/[\s*$<>{}|]|:\/\//.test(span)) return undefined;
  const match = PATH_TOKEN.exec(span);
  const path = match?.[1];
  if (!match || !path) return undefined;
  const segments = path.split("/");
  const looksLikePath = segments.length > 1 || EXTENSION.test(path) || span.endsWith("/");
  if (!looksLikePath || (segments.length > 1 && DOMAIN.test(segments[0] ?? ""))) return undefined;
  const line = match[2] ? Number(match[2]) : undefined;
  const endLine = match[3] ? Number(match[3]) : undefined;
  return { path, ...(line ? { line } : {}), ...(endLine ? { endLine } : {}) };
}

function uniqueCitations(citations: Citation[]): Citation[] {
  const seen = new Map<string, Citation>();
  for (const citation of citations) {
    seen.set(`${citation.path}:${citation.line ?? ""}-${citation.endLine ?? ""}`, citation);
  }
  return [...seen.values()];
}
