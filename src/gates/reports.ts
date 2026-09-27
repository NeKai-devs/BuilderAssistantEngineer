import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Counts } from "./results.js";
import { type Direct, directRunner, type Sources, testRunners } from "./runners.js";

export type Report = { counts: Counts; failing: string[]; source: ReportSource };
export const REPORT_SOURCES = [
  "vitest-json",
  "jest-json",
  "pytest-junit",
  "go-json",
  "dotnet-trx",
] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];
export type Probe = {
  command: string;
  env: Record<string, string>;
  collect: (stdout: string) => Promise<Report | undefined>;
  view?: () => LineView;
  dispose: () => Promise<void>;
};
export type LineView = { push: (chunk: string) => string; end: () => string };

type Tally = { passed: number; failed: number; skipped: number; failing: string[] };
type Attributes = Record<string, string>;

const PASSED = new Set(["passed"]);
const FAILED = new Set(["failed"]);
const TRX_FAILED = new Set(["Failed", "Error", "Timeout", "Aborted"]);
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export async function probeFor(
  cwd: string,
  command: string,
  sources: Sources,
): Promise<Probe | undefined> {
  const direct = directRunner(command, sources);
  if (direct && direct.runner !== "cargo" && direct.runner !== "pytest") {
    return argumentProbe(cwd, command, direct);
  }
  const runners = testRunners(command, sources);
  if (runners.length > 0 && runners.every((name) => name === "pytest")) {
    return pytestProbe(command);
  }
  return undefined;
}

async function argumentProbe(
  cwd: string,
  command: string,
  direct: Direct,
): Promise<Probe | undefined> {
  const { runner, args } = direct;
  if (runner === "go") {
    if (args.includes("-args")) return undefined;
    const json = args.includes("-json") || args.includes("--json");
    return {
      command: json ? command : extend(command, direct.suffix(["-json"])),
      env: {},
      collect: async (stdout) => goReport(stdout),
      view: goView,
      dispose: async () => {},
    };
  }
  if (runner === "vitest" && args.some((arg) => arg.startsWith("--outputFile"))) return undefined;
  if (runner === "jest" && args.some((arg) => arg === "--json" || arg.startsWith("--outputFile"))) {
    return undefined;
  }
  if (runner === "dotnet" && args.some((arg) => arg === "--" || arg === "--results-directory")) {
    return undefined;
  }
  const dir = await mkdtemp(join(tmpdir(), "bae-report-"));
  const file = slashed(join(dir, "report.json"));
  const extra = extraArgs(runner, slashed(dir), file);
  if (!extra) {
    await rm(dir, { recursive: true, force: true });
    return undefined;
  }
  const roots = await rootsOf(cwd);
  return {
    command: extend(command, direct.suffix(extra)),
    env: {},
    collect: async () =>
      runner === "dotnet"
        ? trxReport(await readReports(dir, ".trx"))
        : jestReport(
            await readText(file),
            roots,
            runner === "vitest" ? "vitest-json" : "jest-json",
          ),
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

function extraArgs(runner: Direct["runner"], dir: string, file: string): string[] | undefined {
  if (runner === "vitest")
    return ["--reporter=default", "--reporter=json", `--outputFile.json=${file}`];
  if (runner === "jest") return ["--json", `--outputFile=${file}`];
  if (runner === "dotnet") return ["--logger", "trx", "--results-directory", dir];
  return undefined;
}

async function pytestProbe(command: string): Promise<Probe> {
  const dir = await mkdtemp(join(tmpdir(), "bae-report-"));
  const file = slashed(join(dir, "junit.xml"));
  const existing = process.env.PYTEST_ADDOPTS ?? "";
  return {
    command,
    env: { PYTEST_ADDOPTS: `${existing} --junitxml="${file}"`.trim() },
    collect: async () => junitReport(await readText(file)),
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

export function jestReport(
  text: string | undefined,
  roots: string[],
  source: "vitest-json" | "jest-json",
): Report | undefined {
  const data = parseJson(text);
  const files = Array.isArray(data?.testResults) ? data.testResults : undefined;
  if (!files) return undefined;
  const tally: Tally = { passed: 0, failed: 0, skipped: 0, failing: [] };
  for (const file of files as Record<string, unknown>[]) {
    const name = relativeTo(String(file.name ?? ""), roots);
    const cases = Array.isArray(file.assertionResults)
      ? (file.assertionResults as Record<string, unknown>[])
      : [];
    let failedHere = 0;
    for (const item of cases) {
      const status = String(item.status ?? "");
      if (PASSED.has(status)) tally.passed++;
      else if (FAILED.has(status)) {
        failedHere++;
        tally.failed++;
        tally.failing.push(caseName(name, item));
      } else tally.skipped++;
    }
    if (file.status === "failed" && failedHere === 0) {
      tally.failed++;
      tally.failing.push(name);
    }
  }
  return report(tally, source);
}

export function junitReport(text: string | undefined): Report | undefined {
  if (!text || !/<testsuites?\b/.test(text)) return undefined;
  const tally: Tally = { passed: 0, failed: 0, skipped: 0, failing: [] };
  for (const { attributes, body } of elements(text, "testcase")) {
    const name = [attributes.classname, attributes.name].filter(Boolean).join("::");
    if (/<(failure|error)\b/.test(body)) {
      tally.failed++;
      tally.failing.push(name);
    } else if (/<skipped\b/.test(body)) tally.skipped++;
    else tally.passed++;
  }
  return report(tally, "pytest-junit");
}

export function goReport(stdout: string): Report | undefined {
  const events = stdout.split(/\r?\n/).flatMap((line) => {
    const event = line.startsWith("{") ? parseJson(line) : undefined;
    return event && typeof event.Action === "string" ? [event] : [];
  });
  if (events.length === 0) return undefined;
  const started = new Set<string>();
  const results = new Map<string, string>();
  const packages = new Map<string, string>();
  for (const event of events) {
    const pkg = String(event.Package ?? "");
    const action = String(event.Action);
    if (typeof event.Test !== "string") {
      if (pkg && ["pass", "fail", "skip"].includes(action)) packages.set(pkg, action);
      continue;
    }
    const key = `${pkg}::${event.Test}`;
    if (action === "run") started.add(key);
    else if (["pass", "fail", "skip"].includes(action) && started.has(key)) {
      results.set(key, action);
    }
  }
  const tally: Tally = { passed: 0, failed: 0, skipped: 0, failing: [] };
  for (const [key, action] of results) {
    if (action === "pass") tally.passed++;
    else if (action === "skip") tally.skipped++;
    else {
      tally.failed++;
      tally.failing.push(key);
    }
  }
  for (const [pkg, action] of packages) {
    const failedTests = tally.failing.some((name) => name.startsWith(`${pkg}::`));
    if (action === "fail" && !failedTests) {
      tally.failed++;
      tally.failing.push(pkg);
    }
  }
  return report(tally, "go-json");
}

export function trxReport(texts: string[]): Report | undefined {
  if (texts.length === 0) return undefined;
  const tally: Tally = { passed: 0, failed: 0, skipped: 0, failing: [] };
  for (const text of texts) {
    for (const { attributes } of elements(text, "UnitTestResult")) {
      const outcome = attributes.outcome ?? "";
      if (outcome === "Passed") tally.passed++;
      else if (TRX_FAILED.has(outcome)) {
        tally.failed++;
        tally.failing.push(attributes.testName ?? "");
      } else tally.skipped++;
    }
  }
  return report(tally, "dotnet-trx");
}

export function goText(stdout: string): string {
  const view = goView();
  return view.push(stdout) + view.end();
}

export function goView(): LineView {
  let pending = "";
  const render = (line: string): string => {
    const event = line.startsWith("{") ? parseJson(line) : undefined;
    if (!event || typeof event.Action !== "string") return `${line}\n`;
    return typeof event.Output === "string" ? event.Output : "";
  };
  return {
    push: (chunk) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      return lines.map((line) => render(line.replace(/\r$/, ""))).join("");
    },
    end: () => {
      const rest = pending ? render(pending) : "";
      pending = "";
      return rest;
    },
  };
}

function elements(text: string, tag: string): { attributes: Attributes; body: string }[] {
  const clean = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const pattern = new RegExp(
    `<${tag}((?:\\s+[\\w:.-]+\\s*=\\s*(?:"[^"]*"|'[^']*'))*)\\s*(/?)>`,
    "g",
  );
  const found: { attributes: Attributes; body: string }[] = [];
  for (const match of clean.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = match[2] ? start : clean.indexOf(`</${tag}>`, start);
    found.push({
      attributes: attributesOf(match[1] ?? ""),
      body: end === -1 ? clean.slice(start) : clean.slice(start, end),
    });
  }
  return found;
}

function attributesOf(text: string): Attributes {
  const attributes: Attributes = {};
  for (const match of text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1] ?? ""] = decode(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity] ?? whole;
  });
}

function caseName(file: string, item: Record<string, unknown>): string {
  const ancestors = Array.isArray(item.ancestorTitles) ? item.ancestorTitles.map(String) : [];
  return [file, ...ancestors, String(item.title ?? item.fullName ?? "")].join(" > ");
}

function report(tally: Tally, source: ReportSource): Report {
  const { passed, failed, skipped } = tally;
  return {
    counts: { passed, failed, skipped },
    failing: [...new Set(tally.failing)].sort(),
    source,
  };
}

function relativeTo(path: string, roots: string[]): string {
  const normal = slashed(path);
  const root = roots.find((candidate) => normal.startsWith(`${candidate}/`));
  return root ? normal.slice(root.length + 1) : normal;
}

async function rootsOf(cwd: string): Promise<string[]> {
  const real = await realpath(cwd).catch(() => cwd);
  return [...new Set([slashed(cwd), slashed(real)])];
}

function extend(command: string, extra: string[]): string {
  return extra.length > 0 ? `${command} ${extra.map(quote).join(" ")}` : command;
}

function quote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

function slashed(path: string): string {
  return path.replace(/\\/g, "/");
}

async function readText(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}

async function readReports(dir: string, extension: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const texts = await Promise.all(
    names.filter((name) => name.endsWith(extension)).map((name) => readText(join(dir, name))),
  );
  return texts.filter((text): text is string => text !== undefined);
}

function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
