import { describe, expect, it } from "vitest";
import { directRunner, makeRecipes, testRunners } from "../../src/gates/runners.js";

const none = { scripts: {} };

describe("testRunners", () => {
  it("finds the runner behind npm scripts and make targets", () => {
    expect(
      testRunners("npm test", { scripts: { test: "npm run unit", unit: "vitest run" } }),
    ).toEqual(["vitest"]);
    const makefile = "test: lint\n\tgo test -v ./...\nlint:\n\t@go vet ./...\n";
    expect(testRunners("make test", { scripts: {}, makefile })).toEqual(["go"]);
    expect(testRunners("npm test", { scripts: { test: "react-scripts test" } })).toEqual(["jest"]);
  });

  it("recognizes nothing in a command that only runs a script of the project", () => {
    expect(testRunners("node run-tests.js", none)).toEqual([]);
    expect(testRunners("./scripts/test.sh", none)).toEqual([]);
    expect(testRunners("npx eslint .", none)).toEqual([]);
  });
});

describe("directRunner", () => {
  it("unwraps exec wrappers, node and package managers", () => {
    expect(directRunner("npx vitest run", none)?.runner).toBe("vitest");
    expect(directRunner("node node_modules/jest/bin/jest.js --ci", none)?.runner).toBe("jest");
    expect(directRunner("python -m pytest -q", none)?.runner).toBe("pytest");
    expect(directRunner("yarn vitest run", none)?.runner).toBe("vitest");
    expect(directRunner("CI=1 go test ./...", none)?.runner).toBe("go");
  });

  it("puts npm's -- separator once for every npm hop", () => {
    const scripts = { test: "npm run unit", unit: "vitest run" };
    expect(directRunner("npm test", { scripts })?.suffix(["-x"])).toEqual(["--", "--", "-x"]);
    expect(
      directRunner("npm test -- --coverage", { scripts: { test: "vitest" } })?.suffix(["-x"]),
    ).toEqual(["-x"]);
  });

  it("refuses compound commands and substitutions", () => {
    expect(directRunner("vitest run && eslint .", none)).toBeUndefined();
    expect(directRunner("vitest run $(cat files)", none)).toBeUndefined();
  });
});

describe("makeRecipes", () => {
  it("follows prerequisites and ignores variable assignments", () => {
    const makefile =
      "GO := go\nall: test\n\ntest: deps\n\t$(GO) test ./...\ndeps:\n\t-go mod download\n";
    expect(makeRecipes(makefile, [])).toEqual(["go mod download", "$(GO) test ./..."]);
    expect(makeRecipes(makefile, ["deps"])).toEqual(["go mod download"]);
  });
});
