import { stripVTControlCharacters } from "node:util";
import { z } from "zod";

export const countsSchema = z.object({
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type Counts = z.output<typeof countsSchema>;

type Found = { counts: Counts; at: number };
type Parser = (text: string) => Found | undefined;

export type RunnerName = keyof typeof PARSERS;

const PARSERS = {
  vitest,
  jest,
  pytest,
  cargo,
  go: goTest,
  mocha,
  node: nodeTest,
  bun,
  deno,
  unittest,
  rspec,
  minitest,
  phpunit,
  dotnet,
  surefire,
  eslint,
  playwright,
  errors: errorsFound,
} satisfies Record<string, Parser>;

const HINTS: [RegExp, RunnerName[]][] = [
  [/\bvitest\b/, ["vitest"]],
  [/\bjest\b|\b(react-scripts|craco)\s+test\b/, ["jest"]],
  [/\bmocha\b/, ["mocha"]],
  [/\bnode\b[^|;&]*--test\b/, ["node"]],
  [/\b(pytest|py\.test)\b/, ["pytest"]],
  [/\bgo\s+test\b/, ["go"]],
  [/\bcargo\s+(test|nextest)\b/, ["cargo"]],
  [/\brspec\b/, ["rspec"]],
  [/\b(rails|rake)\s+test\b|\bminitest\b/, ["minitest"]],
  [/\b(phpunit|pest)\b/, ["phpunit"]],
  [/\bdotnet\s+test\b/, ["dotnet"]],
  [/\b(mvnw?|gradlew?)\b/, ["surefire"]],
  [/\bbun\s+test\b/, ["bun"]],
  [/\bdeno\s+test\b/, ["deno"]],
  [/\bunittest\b/, ["unittest"]],
  [/\beslint\b/, ["eslint"]],
  [/\bplaywright\b/, ["playwright"]],
  [/\b(tsc|vue-tsc|biome|ruff|mypy)\b/, ["errors"]],
];

export function runnerHint(command: string): RunnerName[] {
  return [...new Set(HINTS.flatMap(([pattern, names]) => (pattern.test(command) ? names : [])))];
}

export type Summary = { counts: Counts; source: RunnerName };

export function parseSummary(output: string, hint: RunnerName[] = []): Summary | undefined {
  const text = stripVTControlCharacters(output).replace(/\r\n?/g, "\n");
  const names = hint.length > 0 ? hint : (Object.keys(PARSERS) as RunnerName[]);
  const found = names.flatMap((name) => {
    const item = PARSERS[name](text);
    return item ? [{ ...item, source: name }] : [];
  });
  const latest = found.sort((a, b) => b.at - a.at)[0];
  return latest ? { counts: latest.counts, source: latest.source } : undefined;
}

export function parseCounts(output: string, hint: RunnerName[] = []): Counts | undefined {
  return parseSummary(output, hint)?.counts;
}

const FAILING: Partial<Record<RunnerName, RegExp[]>> = {
  vitest: [/^\s*FAIL\s+(\S.*? > .+?)\s*$/gm, /^\s*FAIL\s+(\S+)\s*(?:\[.*\])?\s*$/gm],
  jest: [/^\s*● (?!Test suite failed to run)(.+?)\s*$/gm, /^FAIL\s+(\S+)/gm],
  pytest: [/^(?:FAILED|ERROR) (\S+::\S+|\S+\.py)/gm],
  go: [/^\s*--- FAIL: (\S+)/gm, /^FAIL\s+(\S+)\s+(?:\[.*\]|[\d.]+s)/gm, /^panic: .*/gm],
  cargo: [/^test (\S+) \.\.\. FAILED$/gm, /^error: test failed, to rerun pass (.+)$/gm],
  rspec: [/^rspec (\S+)/gm],
  unittest: [/^(?:FAIL|ERROR): (\S+ \(.+\))$/gm],
  node: [/^not ok \d+ - (.+)$/gm],
  mocha: [/^\s+\d+\) (.+):$/gm],
  phpunit: [/^\d+\) (\S+::\S+)/gm],
  dotnet: [/^\s+Failed (\S+) \[/gm],
  errors: [/^(\S[^(\n]*)\(\d+,\d+\): error (TS\d+)/gm, /^(\S+):\d+:\d+ (lint\/\S+)/gm],
  playwright: [/^\s+\d+\) (\[.+?\] › .+)$/gm],
};
const STRICT: RunnerName[] = ["vitest", "go", "cargo", "unittest"];

export function parseFailing(output: string, hint: RunnerName[]): string[] | undefined {
  const text = stripVTControlCharacters(output).replace(/\r\n?/g, "\n");
  const patterns = (hint.length > 0 ? hint : STRICT).flatMap((name) => FAILING[name] ?? []);
  if (patterns.length === 0) return undefined;
  const names = patterns.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) =>
      (match.slice(1).filter(Boolean).join(" ") || match[0] || "").trim(),
    ),
  );
  return names.length > 0 ? [...new Set(names)].sort() : undefined;
}

export function executed(counts: Counts): number {
  return counts.passed + counts.failed;
}

function counts(passed = 0, failed = 0, skipped = 0): Counts {
  return { passed, failed, skipped };
}

function all(text: string, pattern: RegExp): RegExpExecArray[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))];
}

function last(text: string, pattern: RegExp): RegExpExecArray | undefined {
  return all(text, pattern).at(-1);
}

function number(value: string | undefined): number {
  return value ? Number(value) : 0;
}

function parts(list: string, separator: RegExp): Map<string, number> {
  const found = new Map<string, number>();
  for (const part of list.split(separator)) {
    const match = /(\d+)\s+([a-z]+)/i.exec(part.trim());
    if (match) found.set((match[2] ?? "").toLowerCase(), number(match[1]));
  }
  return found;
}

function at(match: RegExpExecArray | undefined, value: Counts): Found | undefined {
  return match ? { counts: value, at: match.index } : undefined;
}

function vitest(text: string): Found | undefined {
  const match = last(text, /^\s*Tests\s+((?:\d+ [a-z]+(?: [a-z]+)?(?: \| )?)+)\s*\((\d+)\)/m);
  if (!match) return undefined;
  const found = parts(match[1] ?? "", /\|/);
  return at(
    match,
    counts(
      found.get("passed"),
      found.get("failed"),
      (found.get("skipped") ?? 0) + (found.get("todo") ?? 0),
    ),
  );
}

function jest(text: string): Found | undefined {
  const match = last(text, /^Tests:\s+(.*?)(\d+) total$/m);
  if (!match) return undefined;
  const found = parts(match[1] ?? "", /,/);
  return at(
    match,
    counts(
      found.get("passed"),
      found.get("failed"),
      (found.get("skipped") ?? 0) + (found.get("todo") ?? 0),
    ),
  );
}

function pytest(text: string): Found | undefined {
  const match = last(
    text,
    /^(?:=+ )?((?:\d+ (?:passed|failed|skipped|errors?|xfailed|xpassed|deselected|warnings?)(?:, )?)+) in [\d.]+s/m,
  );
  if (!match) return undefined;
  const found = parts(match[1] ?? "", /,/);
  return at(
    match,
    counts(
      (found.get("passed") ?? 0) + (found.get("xpassed") ?? 0),
      (found.get("failed") ?? 0) + (found.get("error") ?? 0) + (found.get("errors") ?? 0),
      (found.get("skipped") ?? 0) + (found.get("xfailed") ?? 0) + (found.get("deselected") ?? 0),
    ),
  );
}

function cargo(output: string): Found | undefined {
  const text = output.replace(/^---- .+ std(?:out|err) ----$[\s\S]*?^failures:$/gm, "");
  const matches = all(
    text,
    /^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/m,
  );
  if (matches.length === 0) return undefined;
  const sum = matches.reduce(
    (total, match) =>
      counts(
        total.passed + number(match[1]),
        total.failed + number(match[2]),
        total.skipped + number(match[3]),
      ),
    counts(),
  );
  return at(matches.at(-1), sum);
}

function goTest(text: string): Found | undefined {
  const verbose = all(text, /^\s*--- (PASS|FAIL|SKIP): /m);
  if (verbose.length === 0 || !/^=== RUN /m.test(text)) return undefined;
  const tally = (kind: string) => verbose.filter((match) => match[1] === kind).length;
  return at(verbose.at(-1), counts(tally("PASS"), tally("FAIL"), tally("SKIP")));
}

function mocha(text: string): Found | undefined {
  const passing = last(text, /^\s*(\d+) passing\b/m);
  if (!passing) return undefined;
  const failing = last(text, /^\s*(\d+) failing\b/m);
  const pending = last(text, /^\s*(\d+) pending\b/m);
  return at(passing, counts(number(passing[1]), number(failing?.[1]), number(pending?.[1])));
}

function nodeTest(text: string): Found | undefined {
  const pass = last(text, /^(?:#|ℹ) pass (\d+)$/m);
  const fail = last(text, /^(?:#|ℹ) fail (\d+)$/m);
  if (!pass || !fail) return undefined;
  const skipped = last(text, /^(?:#|ℹ) skipped (\d+)$/m);
  const todo = last(text, /^(?:#|ℹ) todo (\d+)$/m);
  return at(
    fail,
    counts(number(pass[1]), number(fail[1]), number(skipped?.[1]) + number(todo?.[1])),
  );
}

function bun(text: string): Found | undefined {
  const pass = last(text, /^\s*(\d+) pass$/m);
  const fail = last(text, /^\s*(\d+) fail$/m);
  if (!pass || !fail) return undefined;
  const skip = last(text, /^\s*(\d+) skip$/m);
  const todo = last(text, /^\s*(\d+) todo$/m);
  return at(fail, counts(number(pass[1]), number(fail[1]), number(skip?.[1]) + number(todo?.[1])));
}

function deno(text: string): Found | undefined {
  const match = last(
    text,
    /^(?:ok|FAILED) \| (\d+) passed(?: \(\d+ steps?\))? \| (\d+) failed(?: \(\d+ steps?\))?(?: \| (\d+) ignored)?/m,
  );
  return match
    ? at(match, counts(number(match[1]), number(match[2]), number(match[3])))
    : undefined;
}

function unittest(text: string): Found | undefined {
  const ran = last(text, /^Ran (\d+) tests? in [\d.]+s$/m);
  if (!ran) return undefined;
  const status = last(text, /^(OK|FAILED)(?: \((.*)\))?$/m);
  const found = parts((status?.[2] ?? "").replace(/=/g, " ").replace(/(\w+) (\d+)/g, "$2 $1"), /,/);
  const failed = (found.get("failures") ?? 0) + (found.get("errors") ?? 0);
  const skipped = found.get("skipped") ?? 0;
  return at(ran, counts(number(ran[1]) - failed - skipped, failed, skipped));
}

function rspec(text: string): Found | undefined {
  const match = last(text, /^(\d+) examples?, (\d+) failures?(?:, (\d+) pending)?/m);
  if (!match) return undefined;
  const failed = number(match[2]);
  const skipped = number(match[3]);
  return at(match, counts(number(match[1]) - failed - skipped, failed, skipped));
}

function minitest(text: string): Found | undefined {
  const match = last(
    text,
    /^(\d+) (?:runs|tests), \d+ assertions, (\d+) failures, (\d+) errors, (\d+) skips/m,
  );
  if (!match) return undefined;
  const failed = number(match[2]) + number(match[3]);
  const skipped = number(match[4]);
  return at(match, counts(number(match[1]) - failed - skipped, failed, skipped));
}

function phpunit(text: string): Found | undefined {
  const ok = last(text, /^OK \((\d+) tests?, \d+ assertions?\)/m);
  const match = last(text, /^Tests: (\d+), Assertions: \d+(.*)$/m);
  if (ok && (!match || ok.index > match.index)) return at(ok, counts(number(ok[1])));
  if (!match) return undefined;
  const found = parts((match[2] ?? "").replace(/(\w+): (\d+)/g, "$2 $1"), /,/);
  const failed = (found.get("errors") ?? 0) + (found.get("failures") ?? 0);
  const skipped = (found.get("skipped") ?? 0) + (found.get("incomplete") ?? 0);
  return at(match, counts(number(match[1]) - failed - skipped, failed, skipped));
}

function dotnet(text: string): Found | undefined {
  const matches = all(
    text,
    /(?:Passed|Failed)!\s+-\s+Failed:\s+(\d+),\s+Passed:\s+(\d+),\s+Skipped:\s+(\d+),\s+Total:\s+\d+/,
  );
  if (matches.length === 0) return undefined;
  const sum = matches.reduce(
    (total, match) =>
      counts(
        total.passed + number(match[2]),
        total.failed + number(match[1]),
        total.skipped + number(match[3]),
      ),
    counts(),
  );
  return at(matches.at(-1), sum);
}

function surefire(text: string): Found | undefined {
  const match = last(text, /Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)/);
  if (!match) return undefined;
  const failed = number(match[2]) + number(match[3]);
  const skipped = number(match[4]);
  return at(match, counts(number(match[1]) - failed - skipped, failed, skipped));
}

function playwright(text: string): Found | undefined {
  const passed = last(text, /^\s*(\d+) passed \([\d.]+m?s\)$/m);
  if (!passed) return undefined;
  const failed = last(text, /^\s*(\d+) failed$/m);
  const flaky = last(text, /^\s*(\d+) flaky$/m);
  const skipped = last(text, /^\s*(\d+) skipped$/m);
  return at(
    passed,
    counts(number(passed[1]) + number(flaky?.[1]), number(failed?.[1]), number(skipped?.[1])),
  );
}

function eslint(text: string): Found | undefined {
  const match = last(text, /✖ \d+ problems? \((\d+) errors?, \d+ warnings?\)/);
  return match ? at(match, counts(0, number(match[1]))) : undefined;
}

function errorsFound(text: string): Found | undefined {
  const match = last(text, /^Found (\d+) errors?\b/m);
  if (match) return at(match, counts(0, number(match[1])));
  const lines = all(text, /^\S.*\(\d+,\d+\): error TS\d+:/m);
  return lines.length > 0 ? at(lines.at(-1), counts(0, lines.length)) : undefined;
}
