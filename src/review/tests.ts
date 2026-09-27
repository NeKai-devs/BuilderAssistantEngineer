import { isTestFile } from "../digest/baseline.js";
import type { AddedText } from "./changes.js";

const RUST_TEST = /#\[(?:tokio::)?test\]|#\[cfg\(test\)\]/;
const ASSERTION =
  /\bexpect\s*[({]|\bExpect\s*\(|\bassert\w*!\s*\(|\bassert\w*\s*[(]|\bassert\.\w+\s*\(|^\s*assert\s|\b(?:assert|refute)_\w+\b|\brefute\w*\s*[(\s]|\.should\b|\bshould\s*[.(]|\bshouldBe\b|\.Should\(\)|\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail)\b|\bt\.(?:is|not|equal|deepEqual|true|false|truthy|falsy|ok|notOk|same|match|throws)\s*\(|\brequire\.\w+\(|\bXCTAssert\w*\(|#(?:expect|require)\s*\(|\bAssert\.\w+\(|\bassertThat\(|\bself\.assert\w*\(|\$this->assert\w*\(|\bthrow\b/;
const COMMENT = /^\s*(\/\/|#(?!\[)|\*|\/\*)/;
const DECLARATIONS = [
  /\b(?:it|test|specify)(?:\.\w+)*\s*\(\s*(['"`])(.+?)\1/g,
  /^\s*it\s+(['"])(.+?)\1/gm,
  /^\s*(?:async\s+)?def\s+()(test\w*)\s*\(/gm,
  /^\s*func\s+()(Test\w+)\s*\(/gm,
  /^\s*func\s+()(test\w+)\s*\(/gm,
  /^\s*test\s+(["'])(.+?)\1\s+do\b/gm,
  /\bt\.Run\(\s*(["'`])(.+?)\1/g,
  /\bfunction\s+()(test\w+)\s*\(/g,
  /@(?:Test|ParameterizedTest|RepeatedTest)\b(?:\([^)]*\))?(?:\s*@[\w.]+(?:\([^)]*\))?)*\s*(?:(?:public|protected|private|internal|open|override|suspend|static|final)\s+)*(?:void|fun)\s+()`?([\w ]+?)`?\s*\(/g,
  /\[(?:Fact|Theory|Test|TestMethod|TestCase)\b[^\]]*\](?:\s*\[[^\]]*\])*\s*(?:(?:public|private|internal|protected|static|async)\s+)*(?:void|Task)\s+()(\w+)\s*\(/g,
  /#\[(?:tokio::)?test\](?:\s*#\[[^\]]*\])*\s*(?:pub\s+)?(?:async\s+)?fn\s+()(\w+)\s*\(/g,
];
const ANNOTATED =
  /#\[(?:tokio::)?test\]|@(?:Test|ParameterizedTest|RepeatedTest|TestFactory)\b|\[(?:Fact|Theory|Test|TestMethod|TestCase)\b/g;
const SKIP_MARKERS: [string, RegExp][] = [
  [".skip", /\b(?:it|test|describe|context|suite)(?:\.\w+)*\.(?:skip|skipIf|runIf)\b/],
  [".only", /\b(?:it|test|describe|context|suite)(?:\.\w+)*\.only\b/],
  [".todo", /\b(?:it|test)(?:\.\w+)*\.todo\b/],
  ["pytestmark", /\bpytestmark\s*=.*pytest\.mark\.(?:skip|skipif)\b/],
  ["@pytest.mark.xfail", /\bpytestmark\s*=.*pytest\.mark\.xfail\b|@pytest\.mark\.xfail\b/],
  ["go:build ignore", /^\/\/\s*(?:go:build|\+build)\s+ignore\b/m],
  ["expected failure", /\b(?:it|test)(?:\.\w+)*\.(?:fails|failing)\b|\btest\.fail\s*\(/],
  ["@unittest.expectedFailure", /@unittest\.expectedFailure\b|@expectedFailure\b/],
  ["pytest.xfail", /\bpytest\.xfail\s*\(/],
  ["focused test", /(?:^|[^.\w$])f(?:it|describe)\s*\(/m],
  ["x-prefixed spec", /^\s*x(?:it|describe|context|specify)\s+["']/m],
  ["rspec skip", /^\s*(?:skip|pending)(?:\s+["']|\s*$|\s+do\b)/m],
  [
    "node:test skip",
    /\b(?:it|test|describe|suite)\s*\([^\n]*\bskip\s*:\s*true\b|\bt\.(?:skip|todo)\s*\(/,
  ],
  ["x-prefixed test", /\bx(?:it|describe|test|context)\s*\(/],
  ["test.fixme", /\btest\.fixme\b/],
  ["@pytest.mark.skip", /@pytest\.mark\.(?:skip|skipif)\b/],
  ["pytest.skip", /\bpytest\.skip\s*\(/],
  ["@unittest.skip", /@unittest\.skip\w*/],
  ["t.Skip", /\bt\.Skip(?:f|Now)?\s*\(/],
  ["#[ignore]", /#\[ignore\b/],
  ["@Disabled", /@Disabled\b/],
  ["@Ignore", /@Ignore\b|\[Ignore\b/],
  ["this.skip", /\bthis\.skip\s*\(/],
  ["markTestSkipped", /markTestSkipped\s*\(/],
];
const RUNNER_CONFIG =
  /(^|\/)(vitest\.(config|workspace)|jest\.config|playwright\.config|cypress\.config|karma\.conf|vite\.config)\.[cm]?[jt]s(on)?$|(^|\/)(pytest\.ini|conftest\.py|\.mocharc(\.\w+)?|phpunit\.xml(\.dist)?)$/;
const EXCLUSIONS: [string, RegExp][] = [
  ["testPathIgnorePatterns", /testPathIgnorePatterns/],
  ["testIgnore", /\btestIgnore\b/],
  ["--deselect", /--deselect\b/],
  ["-k", /(^|\s|["'])-k(\s|=)/],
  ["norecursedirs", /\bnorecursedirs\b/],
  ["pytest_collection_modifyitems", /pytest_collection_modifyitems/],
  ["pytest_ignore_collect", /pytest_ignore_collect|collect_ignore/],
  ["testMatch", /\btestMatch\b|\btestRegex\b/],
  ["roots", /\broots\s*:/],
  ["test exclude", /\btest\s*:\s*\{[^}]*\b(?:exclude|include)\b/],
];

const SUPPRESSIONS: [string, RegExp, RegExp | undefined][] = [
  ["@ts-ignore", /@ts-(?:ignore|expect-error|nocheck)\b/, undefined],
  [
    "eslint-disable",
    /eslint-disable(?:-next-line|-line)?\b/,
    /eslint-disable(?:-next-line|-line)?\s+[@\w/-]/,
  ],
  ["biome-ignore", /biome-ignore\b/, /biome-ignore\S*\s+\S/],
  ["type: ignore", /#\s*type:\s*ignore\b/, /#\s*type:\s*ignore\[/],
  ["noqa", /#\s*noqa\b/i, /#\s*noqa:\s*[A-Z]/i],
  ["pylint: disable", /pylint:\s*disable\b/, /pylint:\s*disable=(?!all\b)[\w-]/],
  ["nolint", /\/\/\s*nolint\b/, /\/\/\s*nolint:\w/],
  ["#[allow]", /#!?\[allow\(/, /#!?\[allow\(/],
  [
    "@SuppressWarnings",
    /@SuppressWarnings\b|@Suppress\(/,
    /@SuppressWarnings\(\s*["{]|@Suppress\(\s*"/,
  ],
  ["rubocop:disable", /rubocop:disable\b/, /rubocop:disable\s+(?!all\b)[A-Z]/],
  [
    "phpstan-ignore",
    /@phpstan-ignore|@psalm-suppress/,
    /@phpstan-ignore(?:-next-line|-line)?\s+[\w.]+|@psalm-suppress\s+\w/,
  ],
];
const DIRECTIVES = new Set(["go:build ignore"]);
export const EXPECTED_FAILURES = new Set([
  "expected failure",
  "@unittest.expectedFailure",
  "pytest.xfail",
  "@pytest.mark.xfail",
]);
const EXPECTED_OUTPUT =
  /(^|\/)__snapshots__\/|\.snap$|(^|\/)testdata\/|\.golden$|(^|\/)__fixtures__\/.*\.expected/;

export type Suppressed = { name: string; specific: boolean };

export function suppressionLines(text: string): Suppressed[] {
  return text.split("\n").flatMap((line) =>
    SUPPRESSIONS.filter(([, pattern]) => pattern.test(line)).map(([name, , specific]) => ({
      name,
      specific: specific?.test(line) ?? false,
    })),
  );
}

export function isExpectedOutput(path: string): boolean {
  return EXPECTED_OUTPUT.test(path);
}

export function isTestChange(item: AddedText): boolean {
  return isTestFile(item.path) || (item.path.endsWith(".rs") && RUST_TEST.test(item.text));
}

export function addsAssertions(item: AddedText): boolean {
  return isTestChange(item) && assertionCount(item.text) > 0;
}

export function assertionCount(text: string): number {
  return code(text).filter((line) => ASSERTION.test(line)).length;
}

export function testNames(text: string): string[] {
  const body = code(text).join("\n");
  return DECLARATIONS.flatMap((pattern) =>
    [...body.matchAll(pattern)].map((match) => match[2] ?? ""),
  ).filter(Boolean);
}

export function annotatedCount(text: string): number {
  return [...code(text).join("\n").matchAll(ANNOTATED)].length;
}

function code(text: string): string[] {
  return text.split("\n").filter((line) => !COMMENT.test(line));
}

export function markerCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const kept = new Set(code(text));
  for (const line of text.split("\n")) {
    for (const [name, pattern] of SKIP_MARKERS) {
      if (!kept.has(line) && !DIRECTIVES.has(name)) continue;
      if (pattern.test(line)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

export function isRunnerConfig(path: string): boolean {
  return RUNNER_CONFIG.test(path);
}

export function exclusionKeys(text: string): string[] {
  return EXCLUSIONS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
