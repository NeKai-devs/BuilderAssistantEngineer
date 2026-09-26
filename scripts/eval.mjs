import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { execa } from "execa";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "dist", "bin.js");
const FIXTURES = join(ROOT, "test", "fixtures", "repos");
const BRIEFS = join(ROOT, "scripts", "eval-briefs");
const ARTIFACTS = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "docs/plan", ".claude", ".opencode"];
const TIMEOUT_MS = 30 * 60_000;

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
const runDir = await uniqueDir(join(values.out, runName()));
const results = [];
for (const fixture of fixtures) results.push(await evaluate(fixture));
await writeFile(join(runDir, "summary.md"), summary(results));
console.log(`\nEval saved to ${relative(process.cwd(), runDir) || runDir}`);

async function evaluate(fixture) {
  console.log(`\n== ${fixture}`);
  const repo = await prepareRepo(fixture);
  const outDir = join(runDir, fixture);
  await mkdir(outDir, { recursive: true });
  try {
    const prompt = await cli(repo, ["plan", "--dry-run"]);
    await writeFile(join(outDir, "prompt.md"), extractPrompt(prompt.output));
    const started = Date.now();
    const plan = await cli(repo, ["plan", "--yes"]);
    const durationMs = Date.now() - started;
    await writeFile(join(outDir, "plan.log"), plan.output);
    await copyArtifacts(repo, join(outDir, "output"));
    await copyIfExists(
      join(repo, ".bae", "tmp", "last-response.md"),
      join(outDir, "last-response.md"),
    );
    const meta = { fixture, ...(await describe(repo)), exitCode: plan.exitCode, durationMs };
    await writeFile(join(outDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    console.log(
      `   exit ${plan.exitCode}, ${meta.files} files, ${meta.tasks} tasks, ${Math.round(durationMs / 1000)}s`,
    );
    return meta;
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

async function prepareRepo(fixture) {
  const repo = await mkdtemp(join(tmpdir(), `bae-eval-${fixture}-`));
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

async function describe(repo) {
  const config = JSON.parse(await readFile(join(repo, ".bae", "config.json"), "utf8"));
  const files = await listFiles(repo, ARTIFACTS);
  return {
    backend: config.backend,
    lang: config.lang,
    mode: config.mode,
    targets: config.targets,
    files: files.length,
    tasks: files.filter((path) => path.startsWith("docs/plan/tasks/")).length,
    analystSha256: await sha256(join(ROOT, "src", "prompts", "analyst.md")),
    toolCommit: (await execa("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, reject: false }))
      .stdout,
    date: new Date().toISOString(),
  };
}

async function cli(cwd, args) {
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

async function git(cwd, args) {
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

function extractPrompt(output) {
  const start = output.indexOf("You are the Analyst");
  const end = output.lastIndexOf("\n└");
  if (start === -1) return output;
  return `${output.slice(start, end > start ? end : undefined).trimEnd()}\n`;
}

async function copyArtifacts(repo, target) {
  for (const path of await listFiles(repo, ARTIFACTS)) {
    await mkdir(dirname(join(target, path)), { recursive: true });
    await cp(join(repo, path), join(target, path));
  }
}

async function listFiles(root, entries) {
  const found = [];
  for (const entry of entries) {
    const info = await stat(join(root, entry)).catch(() => undefined);
    if (info?.isFile()) found.push(entry);
    if (info?.isDirectory()) {
      const names = await readdir(join(root, entry), { recursive: true, withFileTypes: true });
      for (const item of names.filter((name) => name.isFile())) {
        found.push(relative(root, join(item.parentPath, item.name)).split("\\").join("/"));
      }
    }
  }
  return found.sort();
}

async function copyIfExists(source, target) {
  await cp(source, target).catch(() => undefined);
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex")
    .slice(0, 12);
}

async function briefNames() {
  return (await readdir(BRIEFS))
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort();
}

function runName() {
  const date = new Date().toISOString().slice(0, 10);
  return values.label ? `${date}-${values.label}` : date;
}

async function uniqueDir(base) {
  for (let index = 1; ; index++) {
    const dir = index === 1 ? base : `${base}-${index}`;
    if (!(await stat(dir).catch(() => undefined))) {
      await mkdir(dir, { recursive: true });
      return dir;
    }
  }
}

function summary(results) {
  const [first] = results;
  const header = [
    `# Eval ${relative(values.out, runDir)}`,
    "",
    `- backend: ${values.backend}`,
    `- lang: ${values.lang}`,
    `- targets: ${values.targets}`,
    `- analyst.md sha256: ${first?.analystSha256 ?? "-"}`,
    `- tool commit: ${first?.toolCommit ?? "-"}`,
    "",
    "| Fixture | Mode | Exit | Files | Tasks | Seconds |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  const rows = results.map(
    (result) =>
      `| ${result.fixture} | ${result.mode} | ${result.exitCode} | ${result.files} | ${result.tasks} | ${Math.round(result.durationMs / 1000)} |`,
  );
  return `${[...header, ...rows].join("\n")}\n`;
}
