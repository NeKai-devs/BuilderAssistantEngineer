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
  /\bfunction\s+()(test\w+)\s*\(/g,
];
const ANNOTATED = /#\[(?:tokio::)?test\]|@Test\b|\[(?:Fact|Test|TestMethod)\]/g;
const SKIP_MARKERS: [string, RegExp][] = [
  [".skip", /\b(?:it|test|describe|context|suite)(?:\.\w+)*\.(?:skip|skipIf|runIf)\b/],
  [".only", /\b(?:it|test|describe|context|suite)(?:\.\w+)*\.only\b/],
  [".todo", /\b(?:it|test)(?:\.\w+)*\.todo\b/],
  ["pytestmark", /\bpytestmark\s*=.*pytest\.mark\.(?:skip|skipif|xfail)\b/],
  ["go:build ignore", /^\/\/\s*(?:go:build|\+build)\s+ignore\b/m],
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
];

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
  if (!isTestChange(item)) return [];
  return SKIP_MARKERS.filter(([, pattern]) => pattern.test(item.text)).map(([name]) => name);
}

export function isRunnerConfig(path: string): boolean {
  return RUNNER_CONFIG.test(path);
}

export function exclusionKeys(text: string): string[] {
  return EXCLUSIONS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
