import { isTestFile } from "../digest/baseline.js";
import type { AddedText } from "./changes.js";

const RUST_TEST = /#\[(?:tokio::)?test\]|#\[cfg\(test\)\]/;
const ASSERTION =
  /\bexpect\s*[({]|\bassert(?:_eq|_ne)?!\s*\(|\bassert\w*\s*[(]|\bassert\s|\.should\b|\bshould\s*[.(]|\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail)\b|\brequire\.\w+\(|\bXCTAssert\w*\(|\bAssert\.\w+\(|\bassertThat\(|\bself\.assert\w*\(|\$this->assert\w*\(/;
const SKIP_MARKERS: [string, RegExp][] = [
  [".skip", /\b(?:it|test|describe|context|suite)\.skip\b/],
  [".only", /\b(?:it|test|describe|context|suite)\.only\b/],
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
  ["exclude", /\bexclude\b/],
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
  return isTestChange(item) && ASSERTION.test(item.text);
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
