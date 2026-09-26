import { stripVTControlCharacters } from "node:util";
import { z } from "zod";

export const countsSchema = z.object({
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type Counts = z.output<typeof countsSchema>;

type Parser = (text: string) => Counts | undefined;

const PARSERS: Parser[] = [
  vitest,
  jest,
  pytest,
  cargo,
  goTest,
  mocha,
  nodeTest,
  bun,
  deno,
  unittest,
  rspec,
  minitest,
  phpunit,
  dotnet,
  surefire,
  eslint,
  errorsFound,
];

export function parseCounts(output: string): Counts | undefined {
  const text = stripVTControlCharacters(output).replace(/\r\n?/g, "\n");
  for (const parser of PARSERS) {
    const counts = parser(text);
    if (counts) return counts;
  }
  return undefined;
}

export function executed(counts: Counts): number {
  return counts.passed + counts.failed;
}

function counts(passed = 0, failed = 0, skipped = 0): Counts {
  return { passed, failed, skipped };
}

function last(text: string, pattern: RegExp): RegExpExecArray | undefined {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  let found: RegExpExecArray | undefined;
  for (const match of text.matchAll(new RegExp(pattern.source, flags))) found = match;
  return found;
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

function vitest(text: string): Counts | undefined {
  const match = last(text, /^\s*Tests\s+((?:\d+ [a-z]+(?: \| )?)+)\s*\((\d+)\)/m);
  if (!match) return undefined;
  const found = parts(match[1] ?? "", /\|/);
  return counts(found.get("passed"), found.get("failed"), found.get("skipped"));
}

function jest(text: string): Counts | undefined {
  const match = last(text, /^Tests:\s+(.*?)(\d+) total$/m);
  if (!match) return undefined;
  const found = parts(match[1] ?? "", /,/);
  return counts(
    found.get("passed"),
    found.get("failed"),
    (found.get("skipped") ?? 0) + (found.get("todo") ?? 0),
  );
}

function pytest(text: string): Counts | undefined {
  const match = last(
    text,
    /^=+ ((?:\d+ (?:passed|failed|skipped|errors?|xfailed|xpassed|deselected|warnings?)(?:, )?)+) in [\d.]+s/m,
  );
  if (!match) return undefined;
  const found = parts(match[1] ?? "", /,/);
  return counts(
    (found.get("passed") ?? 0) + (found.get("xpassed") ?? 0),
    (found.get("failed") ?? 0) + (found.get("error") ?? 0) + (found.get("errors") ?? 0),
    (found.get("skipped") ?? 0) + (found.get("xfailed") ?? 0),
  );
}

function cargo(text: string): Counts | undefined {
  const matches = [
    ...text.matchAll(/^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/gm),
  ];
  if (matches.length === 0) return undefined;
  return matches.reduce(
    (sum, match) =>
      counts(
        sum.passed + number(match[1]),
        sum.failed + number(match[2]),
        sum.skipped + number(match[3]),
      ),
    counts(),
  );
}

function goTest(text: string): Counts | undefined {
  const verbose = [...text.matchAll(/^\s*--- (PASS|FAIL|SKIP): /gm)].map((match) => match[1]);
  if (verbose.length > 0) {
    const tally = (kind: string) => verbose.filter((value) => value === kind).length;
    return counts(tally("PASS"), tally("FAIL"), tally("SKIP"));
  }
  const passed = [...text.matchAll(/^ok\s+\S+\s+(?:[\d.]+s|\(cached\))/gm)].length;
  const failed = [...text.matchAll(/^FAIL\s+\S+\s+[\d.]+s/gm)].length;
  return passed + failed > 0 ? counts(passed, failed) : undefined;
}

function mocha(text: string): Counts | undefined {
  const passing = last(text, /^\s*(\d+) passing\b/m);
  if (!passing) return undefined;
  const failing = last(text, /^\s*(\d+) failing\b/m);
  const pending = last(text, /^\s*(\d+) pending\b/m);
  return counts(number(passing[1]), number(failing?.[1]), number(pending?.[1]));
}

function nodeTest(text: string): Counts | undefined {
  const pass = last(text, /^(?:#|ℹ) pass (\d+)$/m);
  const fail = last(text, /^(?:#|ℹ) fail (\d+)$/m);
  if (!pass || !fail) return undefined;
  const skipped = last(text, /^(?:#|ℹ) skipped (\d+)$/m);
  const todo = last(text, /^(?:#|ℹ) todo (\d+)$/m);
  return counts(number(pass[1]), number(fail[1]), number(skipped?.[1]) + number(todo?.[1]));
}

function bun(text: string): Counts | undefined {
  const pass = last(text, /^\s*(\d+) pass$/m);
  const fail = last(text, /^\s*(\d+) fail$/m);
  if (!pass || !fail) return undefined;
  const skip = last(text, /^\s*(\d+) (?:skip|todo)$/m);
  return counts(number(pass[1]), number(fail[1]), number(skip?.[1]));
}

function deno(text: string): Counts | undefined {
  const match = last(
    text,
    /^(?:ok|FAILED) \| (\d+) passed(?: \(\d+ steps?\))? \| (\d+) failed(?: \(\d+ steps?\))?(?: \| (\d+) ignored)?/m,
  );
  return match ? counts(number(match[1]), number(match[2]), number(match[3])) : undefined;
}

function unittest(text: string): Counts | undefined {
  const ran = last(text, /^Ran (\d+) tests? in [\d.]+s$/m);
  if (!ran) return undefined;
  const status = last(text, /^(OK|FAILED)(?: \((.*)\))?$/m);
  const found = parts((status?.[2] ?? "").replace(/=/g, " ").replace(/(\w+) (\d+)/g, "$2 $1"), /,/);
  const failed = (found.get("failures") ?? 0) + (found.get("errors") ?? 0);
  const skipped = found.get("skipped") ?? 0;
  return counts(number(ran[1]) - failed - skipped, failed, skipped);
}

function rspec(text: string): Counts | undefined {
  const match = last(text, /^(\d+) examples?, (\d+) failures?(?:, (\d+) pending)?/m);
  if (!match) return undefined;
  const failed = number(match[2]);
  const skipped = number(match[3]);
  return counts(number(match[1]) - failed - skipped, failed, skipped);
}

function minitest(text: string): Counts | undefined {
  const match = last(
    text,
    /^(\d+) (?:runs|tests), \d+ assertions, (\d+) failures, (\d+) errors, (\d+) skips/m,
  );
  if (!match) return undefined;
  const failed = number(match[2]) + number(match[3]);
  const skipped = number(match[4]);
  return counts(number(match[1]) - failed - skipped, failed, skipped);
}

function phpunit(text: string): Counts | undefined {
  const ok = last(text, /^OK \((\d+) tests?, \d+ assertions?\)/m);
  if (ok) return counts(number(ok[1]));
  const match = last(text, /^Tests: (\d+), Assertions: \d+(.*)$/m);
  if (!match) return undefined;
  const found = parts((match[2] ?? "").replace(/(\w+): (\d+)/g, "$2 $1"), /,/);
  const failed = (found.get("errors") ?? 0) + (found.get("failures") ?? 0);
  const skipped = (found.get("skipped") ?? 0) + (found.get("incomplete") ?? 0);
  return counts(number(match[1]) - failed - skipped, failed, skipped);
}

function dotnet(text: string): Counts | undefined {
  const matches = [
    ...text.matchAll(
      /(?:Passed|Failed)!\s+-\s+Failed:\s+(\d+),\s+Passed:\s+(\d+),\s+Skipped:\s+(\d+),\s+Total:\s+\d+/g,
    ),
  ];
  if (matches.length === 0) return undefined;
  return matches.reduce(
    (sum, match) =>
      counts(
        sum.passed + number(match[2]),
        sum.failed + number(match[1]),
        sum.skipped + number(match[3]),
      ),
    counts(),
  );
}

function surefire(text: string): Counts | undefined {
  const match = last(text, /Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)/);
  if (!match) return undefined;
  const failed = number(match[2]) + number(match[3]);
  const skipped = number(match[4]);
  return counts(number(match[1]) - failed - skipped, failed, skipped);
}

function eslint(text: string): Counts | undefined {
  const match = last(text, /✖ \d+ problems? \((\d+) errors?, \d+ warnings?\)/);
  return match ? counts(0, number(match[1])) : undefined;
}

function errorsFound(text: string): Counts | undefined {
  const match = last(text, /^Found (\d+) errors?\b/m);
  return match ? counts(0, number(match[1])) : undefined;
}
