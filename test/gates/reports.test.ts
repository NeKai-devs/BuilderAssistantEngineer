import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  goReport,
  goText,
  jestReport,
  junitReport,
  probeFor,
  trxReport,
} from "../../src/gates/reports.js";
import { parseSummary } from "../../src/gates/results.js";

const fixture = (name: string) =>
  readFile(join(import.meta.dirname, "..", "fixtures", "reports", name), "utf8");

describe("runner reports", () => {
  it("reads vitest's JSON report, counting a file that failed to load as a failure", async () => {
    const report = jestReport(await fixture("vitest.json"), ["/repo"], "vitest-json");
    expect(report).toEqual({
      counts: { passed: 1, failed: 2, skipped: 2 },
      failing: ["group > fails", "test/broken.test.js"],
      source: "vitest-json",
      units: ["test/a.test.js", "test/broken.test.js"],
    });
  });

  it("reads jest's JSON report the same way", async () => {
    const report = jestReport(await fixture("jest.json"), ["/repo"], "jest-json");
    expect(report?.counts).toEqual({ passed: 1, failed: 2, skipped: 2 });
    expect(report?.failing).toEqual(["group > fails", "test/broken.test.js"]);
  });

  it("reads pytest's JUnit XML, including errors, xfail and collection failures", async () => {
    expect(junitReport(await fixture("pytest.xml"))).toEqual({
      counts: { passed: 3, failed: 3, skipped: 2 },
      failing: [
        "tests.test_a::test_error",
        "tests.test_a::test_fails",
        "tests.test_a::test_param[2]",
      ],
      source: "pytest-junit",
      units: ["tests.test_a", "tests.test_a.TestGroup"],
    });
    expect(junitReport(await fixture("pytest-collection.xml"))?.counts).toEqual({
      passed: 0,
      failed: 1,
      skipped: 0,
    });
  });

  it("reads go test -json, ignoring results printed by the tests themselves", async () => {
    const report = goReport(await fixture("go.jsonl"));
    expect(report?.counts).toEqual({ passed: 3, failed: 4, skipped: 1 });
    expect(report?.failing).toEqual([
      "example.com/s/a::TestFails",
      "example.com/s/a::TestSub",
      "example.com/s/a::TestSub/two",
      "example.com/s/b",
    ]);
  });

  it("turns go test -json back into the text a person reads", async () => {
    const text = goText(await fixture("go.jsonl"));
    expect(text).toContain("--- FAIL: TestFails");
    expect(text).toContain("b/b_test.go:5:32: undefined: undefinedThing");
    expect(text).not.toContain('"Time"');
  });

  it("sums the TRX files of every test project", async () => {
    const report = trxReport([await fixture("dotnet-1.trx"), await fixture("dotnet-2.trx")]);
    expect(report?.counts).toEqual({ passed: 3, failed: 2, skipped: 1 });
    expect(report?.failing).toEqual(["A.Tests.UnitTest1.Fails", "A.Tests.UnitTest1.Param(n: 2)"]);
  });

  it("reads cargo's standard output without counting a summary a test printed", async () => {
    expect(parseSummary(await fixture("cargo.txt"), ["cargo"])?.counts).toEqual({
      passed: 1,
      failed: 1,
      skipped: 1,
    });
  });

  it("gives nothing for a report that is missing or malformed", () => {
    expect(jestReport(undefined, [], "vitest-json")).toBeUndefined();
    expect(jestReport("{}", [], "jest-json")).toBeUndefined();
    expect(junitReport("<html></html>")).toBeUndefined();
    expect(goReport("ok  \texample.com/a\t0.01s\n")).toBeUndefined();
    expect(trxReport([])).toBeUndefined();
  });
});

describe("probeFor", () => {
  const sources = (scripts: Record<string, string> = {}, makefile?: string) => ({
    scripts,
    ...(makefile ? { makefile } : {}),
  });

  it("asks vitest and jest for a JSON report, through npm scripts too", async () => {
    const direct = await probeFor("/repo", "npx vitest run", sources());
    expect(direct?.command).toMatch(
      /^npx vitest run --reporter=default --reporter=json '?--outputFile\.json=\S+report\.json'?$/,
    );
    const npm = await probeFor("/repo", "npm test", sources({ test: "jest --ci" }));
    expect(npm?.command).toMatch(/^npm test -- --json '?--outputFile=\S+report\.json'?$/);
    const pnpm = await probeFor("/repo", "pnpm test", sources({ test: "vitest run" }));
    expect(pnpm?.command).toMatch(/^pnpm test --reporter=default/);
    await Promise.all([direct, npm, pnpm].map((probe) => probe?.dispose()));
  });

  it("uses go test -json, dotnet's TRX logger and pytest's JUnit XML", async () => {
    expect((await probeFor("/repo", "go test -v ./...", sources()))?.command).toBe(
      "go test ./... -json",
    );
    const dotnet = await probeFor("/repo", "dotnet test", sources());
    expect(dotnet?.command).toMatch(/^dotnet test --logger trx --results-directory '?\S+'?$/);
    const pytest = await probeFor("/repo", "make test", sources({}, "test:\n\tpytest -q\n"));
    expect(pytest?.command).toBe("make test");
    expect(pytest?.env.PYTEST_ADDOPTS).toMatch(/--junitxml="\S+junit\.xml"$/);
    await Promise.all([dotnet, pytest].map((probe) => probe?.dispose()));
  });

  it("leaves commands it cannot extend safely to the text summary", async () => {
    const compound = sources({ test: "vitest run && eslint ." });
    expect(await probeFor("/repo", "npm test", compound)).toBeUndefined();
    expect(await probeFor("/repo", "cargo test", sources())).toBeUndefined();
    expect(
      await probeFor("/repo", "npx vitest run --outputFile=x.json", sources()),
    ).toBeUndefined();
    expect(await probeFor("/repo", "go test ./... -args -v", sources())).toBeUndefined();
    expect(await probeFor("/repo", "node run-tests.js", sources())).toBeUndefined();
  });
});
