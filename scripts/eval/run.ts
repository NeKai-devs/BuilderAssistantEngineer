import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { execa } from "execa";
import type { PlanReport } from "../../src/plan/report.js";
import {
  type ArtifactFile,
  formatRatio,
  measurePlan,
  type PlanMetrics,
  sumRatios,
} from "./metrics.js";

type Result = PlanMetrics & {
  fixture: string;
  mode: string;
  exitCode: number;
  files: number;
  commands: number;
  durationMs: number;
  report: Partial<PlanReport>;
};

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "dist", "bin.js");
const FIXTURES = join(ROOT, "test", "fixtures", "repos");
const BRIEFS = join(ROOT, "scripts", "eval", "briefs");
const ARTIFACTS = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "docs/plan", ".claude", ".opencode"];
const TIMEOUT_MS = 90 * 60_000;

const { values } = parseArgs({
  options: {
    backend: { type: "string", default: "claude" },
    lang: { type: "string", default: "en" },
    targets: { type: "string", default: "claude-code,opencode" },
    only: { type: "string" },
    label: { type: "string" },
    out: { type: "string", default: join(ROOT, "eval") },
  },
});

const fixtures = values.only ? values.only.split(",") : await briefNames();
const runDir = await uniqueDir(
  join(values.out, values.label ?? new Date().toISOString().slice(0, 10)),
);
const toolCommit = (
  await execa("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, reject: false })
).stdout;
const analystSha = await sha256(join(ROOT, "src", "prompts", "analyst.md"));
const results: Result[] = [];
for (const fixture of fixtures) results.push(await evaluate(fixture));
await writeFile(join(runDir, "summary.md"), summary(results));
console.log(`\nEval saved to ${relative(process.cwd(), runDir) || runDir}`);

async function evaluate(fixture: string): Promise<Result> {
  console.log(`\n== ${fixture}`);
  const parent = await mkdtemp(join(tmpdir(), "bae-eval-"));
  const repo = await prepareRepo(fixture, join(parent, fixture));
  const outDir = join(runDir, fixture);
  await mkdir(outDir, { recursive: true });
  try {
    const dry = await cli(repo, ["plan", "--dry-run"]);
    await writeFile(join(outDir, "prompt.md"), extractPrompt(dry.output));
    const started = Date.now();
    const plan = await cli(repo, ["plan", "--yes"]);
    const durationMs = Date.now() - started;
    await writeFile(join(outDir, "cli-output.txt"), plan.output);
    const artifacts = await readArtifacts(repo);
    await copyArtifacts(repo, artifacts, join(outDir, "output"));
    await cp(join(repo, ".bae", "tmp", "last-response.md"), join(outDir, "last-response.md")).catch(
      () => {},
    );
    const config = JSON.parse(await readFile(join(repo, ".bae", "config.json"), "utf8"));
    const result: Result = {
      fixture,
      mode: config.mode,
      exitCode: plan.exitCode,
      files: artifacts.length,
      commands: Object.keys(config.commands ?? {}).length,
      durationMs,
      report: await readReport(repo),
      ...(await measurePlan(repo, artifacts)),
    };
    await writeFile(join(outDir, "meta.json"), `${JSON.stringify(meta(result), null, 2)}\n`);
    console.log(
      `   exit ${plan.exitCode}, ${result.files} files, ${result.tasks} tasks, ${minutes(durationMs)} min`,
    );
    return result;
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

async function prepareRepo(fixture: string, repo: string): Promise<string> {
  await cp(join(FIXTURES, fixture), repo, { recursive: true });
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-q", "--allow-empty", "-m", "chore: initial state"]);
  await mkdir(join(repo, ".bae"), { recursive: true });
  await cp(join(BRIEFS, `${fixture}.md`), join(repo, ".bae", "brief.md"));
  const init = await cli(repo, ["init", "--yes", "--brief", ".bae/brief.md"]);
  if (init.exitCode !== 0) throw new Error(`init failed for ${fixture}:\n${init.output}`);
  const configPath = join(repo, ".bae", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.targets = values.targets.split(",");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return repo;
}

async function cli(cwd: string, args: string[]) {
  const result = await execa(
    process.execPath,
    [CLI, ...args, "--backend", values.backend, "--lang", values.lang],
    {
      cwd,
      all: true,
      reject: false,
      timeout: TIMEOUT_MS,
      env: { NO_COLOR: "1", PWD: cwd },
      stdin: "ignore",
    },
  );
  return { exitCode: result.exitCode ?? -1, output: stripVTControlCharacters(result.all ?? "") };
}

async function git(cwd: string, args: string[]) {
  const identity = [
    "-c",
    "user.name=bae-eval",
    "-c",
    "user.email=eval@example.com",
    "-c",
    "commit.gpgsign=false",
  ];
  const result = await execa("git", [...identity, ...args], {
    cwd,
    reject: false,
    env: { PWD: cwd },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr);
}

async function readReport(repo: string): Promise<Partial<PlanReport>> {
  const text = await readFile(join(repo, ".bae", "tmp", "plan-report.json"), "utf8").catch(
    () => "{}",
  );
  return JSON.parse(text);
}

async function readArtifacts(repo: string): Promise<ArtifactFile[]> {
  const paths = await listFiles(repo, ARTIFACTS);
  return Promise.all(
    paths.map(async (path) => ({ path, text: await readFile(join(repo, path), "utf8") })),
  );
}

async function copyArtifacts(repo: string, artifacts: ArtifactFile[], target: string) {
  for (const { path } of artifacts) {
    await mkdir(dirname(join(target, path)), { recursive: true });
    await cp(join(repo, path), join(target, path));
  }
}

async function listFiles(root: string, entries: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const entry of entries) {
    const info = await stat(join(root, entry)).catch(() => undefined);
    if (info?.isFile()) found.push(entry);
    if (info?.isDirectory()) {
      const items = await readdir(join(root, entry), { recursive: true, withFileTypes: true });
      for (const item of items.filter((candidate) => candidate.isFile())) {
        found.push(relative(root, join(item.parentPath, item.name)).split("\\").join("/"));
      }
    }
  }
  return found.sort();
}

function extractPrompt(output: string): string {
  const start = output.indexOf("You are the Analyst");
  const end = output.lastIndexOf("\n└");
  if (start === -1) return output;
  const prompt = output.slice(start, end > start ? end : undefined).replace(/(\s*│)+\s*$/, "");
  return `${prompt.trimEnd()}\n`;
}

function meta(result: Result) {
  const { report, ...rest } = result;
  return {
    ...rest,
    backend: values.backend,
    models: report.models ?? [],
    costUsd: report.costUsd,
    continuations: report.continuations ?? 0,
    formatRetries: report.formatRetries ?? 0,
    formatErrors: report.formatErrors ?? [],
    questions: report.questions ?? 0,
    blockingQuestions: report.blockingQuestions ?? 0,
    evidenceRetries: report.evidenceRetries ?? 0,
    unverifiedPaths: report.unverifiedPaths ?? [],
    repairs: report.repairs ?? [],
    nonPlanAnswers: report.nonPlanAnswers ?? 0,
    verificationRetries: report.verificationRetries ?? 0,
    needsReview: report.needsReview ?? [],
    lang: values.lang,
    targets: values.targets.split(","),
    analystSha256: analystSha,
    toolCommit,
    date: new Date().toISOString(),
  };
}

function summary(results: Result[]): string {
  const models = [...new Set(results.flatMap((result) => result.report.models ?? []))];
  const header = [
    `# Eval ${relative(values.out, runDir)}`,
    "",
    `- Backend: ${values.backend}`,
    `- Models: ${models.join(", ") || "unknown"}`,
    `- Language: ${values.lang}; targets: ${values.targets}`,
    `- analyst.md sha256: ${analystSha}; tool commit: ${toolCommit}; date: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "| Fixture | Mode | Exit | Files | Tasks | Tasks with verification | file:line refs valid | Cited paths that exist | Existence claims verified | Questions (blocking) | Continuations | Format retries | Local repairs | Evidence retries | Unverified after retry | Not a plan | Verification fixes | Needs review | Runs unattended | Commands | tests: required | Empty Log | Minutes | Cost USD |",
    `|${" --- |".repeat(24)}`,
  ];
  return `${[...header, ...results.map(row), totals(results)].join("\n")}\n`;
}

function row(result: Result): string {
  const { report } = result;
  return cells([
    result.fixture,
    result.mode,
    String(result.exitCode),
    String(result.files),
    String(result.tasks),
    formatRatio(result.tasksWithVerification),
    formatRatio(result.lineRefs),
    formatRatio(result.paths),
    formatRatio(result.claims),
    `${report.questions ?? 0} (${report.blockingQuestions ?? 0})`,
    String(report.continuations ?? 0),
    String(report.formatRetries ?? 0),
    String(report.repairs?.length ?? 0),
    String(report.evidenceRetries ?? 0),
    String(report.unverifiedPaths?.length ?? 0),
    String(report.nonPlanAnswers ?? 0),
    String(report.verificationRetries ?? 0),
    String(report.needsReview?.length ?? 0),
    formatRatio(result.unattended),
    `${result.commands}/4`,
    formatRatio(result.testsRequired),
    formatRatio(result.tasksWithLog),
    minutes(result.durationMs),
    cost(report.costUsd),
  ]);
}

function totals(results: Result[]): string {
  const sum = (pick: (result: Result) => number) =>
    results.reduce((total, result) => total + pick(result), 0);
  const costs = results
    .map((result) => result.report.costUsd)
    .filter((value) => value !== undefined);
  return cells([
    "**Total**",
    "",
    `${results.filter((result) => result.exitCode === 0).length}/${results.length} ok`,
    String(sum((result) => result.files)),
    String(sum((result) => result.tasks)),
    formatRatio(sumRatios(results.map((result) => result.tasksWithVerification))),
    formatRatio(sumRatios(results.map((result) => result.lineRefs))),
    formatRatio(sumRatios(results.map((result) => result.paths))),
    formatRatio(sumRatios(results.map((result) => result.claims))),
    `${sum((result) => result.report.questions ?? 0)} (${sum((result) => result.report.blockingQuestions ?? 0)})`,
    String(sum((result) => result.report.continuations ?? 0)),
    String(sum((result) => result.report.formatRetries ?? 0)),
    String(sum((result) => result.report.repairs?.length ?? 0)),
    String(sum((result) => result.report.evidenceRetries ?? 0)),
    String(sum((result) => result.report.unverifiedPaths?.length ?? 0)),
    String(sum((result) => result.report.nonPlanAnswers ?? 0)),
    String(sum((result) => result.report.verificationRetries ?? 0)),
    String(sum((result) => result.report.needsReview?.length ?? 0)),
    formatRatio(sumRatios(results.map((result) => result.unattended))),
    `${sum((result) => result.commands)}/${results.length * 4}`,
    formatRatio(sumRatios(results.map((result) => result.testsRequired))),
    formatRatio(sumRatios(results.map((result) => result.tasksWithLog))),
    minutes(sum((result) => result.durationMs)),
    costs.length > 0 ? cost(costs.reduce((total, value) => total + (value ?? 0), 0)) : "-",
  ]);
}

function cells(values: string[]): string {
  return `| ${values.join(" | ")} |`;
}

function minutes(ms: number): string {
  return (ms / 60_000).toFixed(1);
}

function cost(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(2);
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex")
    .slice(0, 12);
}

async function briefNames(): Promise<string[]> {
  return (await readdir(BRIEFS))
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort();
}

async function uniqueDir(base: string): Promise<string> {
  for (let index = 1; ; index++) {
    const dir = index === 1 ? base : `${base}-${index}`;
    if (!(await stat(dir).catch(() => undefined))) {
      await mkdir(dir, { recursive: true });
      return dir;
    }
  }
}
