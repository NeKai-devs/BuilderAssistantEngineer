import { isTestFile } from "../digest/baseline.js";
import type { AddedText } from "./changes.js";

const RUST_TEST = /#\[(?:tokio::)?test\]|#\[cfg\(test\)\]/;
const ASSERTION =
  /\bexpect\s*[({]|\bassert(?:_eq|_ne)?!\s*\(|\bassert\w*\s*[(]|^\s*assert\s|\.should\b|\bshould\s*[.(]|\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail)\b|\brequire\.\w+\(|\bXCTAssert\w*\(|\bAssert\.\w+\(|\bassertThat\(|\bself\.assert\w*\(|\$this->assert\w*\(|\bthrow\b/;
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
];
const ANNOTATED =
  /#\[(?:tokio::)?test\]|@(?:Test|ParameterizedTest|RepeatedTest|TestFactory)\b|\[(?:Fact|Theory|Test|TestMethod|TestCase)\b/g;
const SKIP_MARKERS: [string, RegExp][] = [
  [".skip", /\b(?:it|test|describe|context|suite)(?:\.\w+)*\.(?:skip|skipIf|runIf)\b/],
  [".only", /\b(?:it|test|describe|context|suite)(?:\.\w+)*\.only\b/],
  [".todo", /\b(?:it|test)(?:\.\w+)*\.todo\b/],
  ["pytestmark", /\bpytestmark\s*=.*pytest\.mark\.(?:skip|skipif|xfail)\b/],
  ["go:build ignore", /^\/\/\s*(?:go:build|\+build)\s+ignore\b/m],
  ["expected failure", /\b(?:it|test)(?:\.\w+)*\.(?:fails|failing)\b|\btest\.fail\s*\(/],
  ["@unittest.expectedFailure", /@unittest\.expectedFailure\b|@expectedFailure\b/],
  ["#[should_panic]", /#\[should_panic\b/],
  ["pytest.xfail", /\bpytest\.xfail\s*\(/],
  ["focused test", /\bf(?:it|describe)\s*\(/],
  ["x-prefixed spec", /^\s*x(?:it|describe|context|specify)\s+["']/m],
  ["rspec skip", /^\s*(?:skip|pending)(?:\s+["']|\s*$|\s+do\b)/m],
  ["node:test skip", /\bskip\s*:\s*true\b|\bt\.(?:skip|todo)\s*\(/],
  ["x-prefixed test", /\bx(?:it|describe|test|context)\s*\(/],
  ["test.fixme", /\btest\.fixme\b/],
  ["@pytest.mark.skip", /@pytest\.mark\.(?:skip|skipif|xfail)\b/],
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

const SUPPRESSIONS: [string, RegExp][] = [
  ["@ts-ignore", /@ts-(?:ignore|expect-error|nocheck)\b/],
  ["eslint-disable", /eslint-disable(?:-next-line|-line)?\b/],
  ["biome-ignore", /biome-ignore\b/],
  ["type: ignore", /#\s*type:\s*ignore\b/],
  ["noqa", /#\s*noqa\b/],
  ["pylint: disable", /pylint:\s*disable\b/],
  ["nolint", /\/\/\s*nolint\b/],
  ["#[allow]", /#!?\[allow\(/],
  ["@SuppressWarnings", /@SuppressWarnings\b|@Suppress\(/],
  ["rubocop:disable", /rubocop:disable\b/],
  ["phpstan-ignore", /@phpstan-ignore|@psalm-suppress/],
];
const EXPECTED_OUTPUT =
  /(^|\/)__snapshots__\/|\.snap$|(^|\/)testdata\/|\.golden$|(^|\/)__fixtures__\/.*\.expected/;

export function suppressions(item: AddedText): string[] {
  return SUPPRESSIONS.filter(([, pattern]) => pattern.test(item.text)).map(([name]) => name);
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

export function skipMarkers(item: AddedText): string[] {
  if (!isTestChange(item) && !item.path.endsWith(".rs")) return [];
  return SKIP_MARKERS.filter(([, pattern]) => pattern.test(item.text)).map(([name]) => name);
}

export function isRunnerConfig(path: string): boolean {
  return RUNNER_CONFIG.test(path);
}

export function exclusionKeys(text: string): string[] {
  return EXCLUSIONS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
