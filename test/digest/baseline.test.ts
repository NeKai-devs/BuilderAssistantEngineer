import { describe, expect, it } from "vitest";
import { detectBaseline } from "../../src/digest/baseline.js";
import { type Manifest, toManifest } from "../../src/digest/manifests.js";

function manifests(entries: Record<string, string>): Manifest[] {
  return Object.entries(entries).flatMap(([path, text]) => toManifest(path, text) ?? []);
}

describe("detectBaseline", () => {
  it("reports everything absent for an empty project", () => {
    expect(detectBaseline([], [])).toEqual({
      tests: [],
      lint: [],
      formatter: [],
      typecheck: [],
      ci: [],
    });
  });

  it("collects evidence from dependencies, config files and test files", () => {
    const pkg = JSON.stringify({
      devDependencies: { vitest: "4", "@biomejs/biome": "2", typescript: "5" },
    });
    const baseline = detectBaseline(
      ["package.json", "biome.json", "tsconfig.json", "src/a.test.ts", ".github/workflows/ci.yml"],
      manifests({ "package.json": pkg }),
    );
    expect(baseline.tests).toEqual(["vitest (package.json)", "1 test file, e.g. src/a.test.ts"]);
    expect(baseline.lint).toEqual(["@biomejs/biome (package.json)", "biome.json"]);
    expect(baseline.formatter).toEqual(["@biomejs/biome (package.json)", "biome.json"]);
    expect(baseline.typecheck).toEqual(["typescript (package.json)", "tsconfig.json"]);
    expect(baseline.ci).toEqual([".github/workflows/ci.yml"]);
  });

  it("reads pyproject tool sections", () => {
    const baseline = detectBaseline(
      ["pyproject.toml"],
      manifests({
        "pyproject.toml": "[tool.black]\nline-length = 88\n[tool.mypy]\nstrict = true\n",
      }),
    );
    expect(baseline.formatter).toEqual(["[tool.black] (pyproject.toml)"]);
    expect(baseline.typecheck).toEqual(["[tool.mypy] (pyproject.toml)"]);
    expect(baseline.lint).toEqual([]);
  });

  it("credits toolchain defaults for compiled ecosystems", () => {
    const baseline = detectBaseline(["go.mod"], manifests({ "go.mod": "module x\n" }));
    expect(baseline.formatter).toEqual(["gofmt (Go toolchain)"]);
    expect(baseline.typecheck).toEqual(["Go compiler"]);
  });
});
