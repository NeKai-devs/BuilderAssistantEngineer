import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findExecutable } from "../../../src/core/which.js";
import { readCapture } from "../../../src/gates/capture.js";
import { agent, bypassRepo, next, REVIEW_PASS, statusOf } from "../bypass/harness.js";

const VITEST = resolve(import.meta.dirname, "../../../node_modules/vitest/vitest.mjs").replace(
  /\\/g,
  "/",
);
const has = async (name: string) => Boolean(await findExecutable(name));
const SLOW = 180_000;

type Project = {
  test: string;
  source: string;
  files: Record<string, string>;
  work: Record<string, string>;
  broken: Record<string, string>;
};

const PROJECTS: Record<string, Project> = {
  node: {
    source: "node-junit",
    test: "node --test",
    files: {
      "src/sum.js": "exports.sum = (a, b) => a + b;\n",
      "test/sum.test.js":
        'const test = require("node:test");\nconst assert = require("node:assert");\nconst { sum } = require("../src/sum.js");\ntest("adds", () => assert.strictEqual(sum(1, 2), 3));\n',
    },
    work: {
      "src/mul.js": "exports.mul = (a, b) => a * b;\n",
      "test/mul.test.js":
        'const test = require("node:test");\nconst assert = require("node:assert");\nconst { mul } = require("../src/mul.js");\ntest("multiplies", () => assert.strictEqual(mul(2, 3), 6));\n',
    },
    broken: { "src/sum.js": "exports.sum = (a, b) => a - b;\n" },
  },
  vitest: {
    source: "vitest-json",
    test: `node '${VITEST}' run --globals`,
    files: {
      ".gitignore": "node_modules/\n",
      "package.json": '{ "type": "module" }\n',
      "src/sum.js": "export const sum = (a, b) => a + b;\n",
      "test/sum.test.js":
        'import { sum } from "../src/sum.js";\nit("adds", () => expect(sum(1, 2)).toBe(3));\n',
    },
    work: {
      "src/mul.js": "export const mul = (a, b) => a * b;\n",
      "test/mul.test.js":
        'import { mul } from "../src/mul.js";\nit("multiplies", () => expect(mul(2, 3)).toBe(6));\n',
    },
    broken: { "src/sum.js": "export const sum = (a, b) => a - b;\n" },
  },
  go: {
    source: "go-json",
    test: "go test -v ./...",
    files: {
      "go.mod": "module example.com/legit\n\ngo 1.21\n",
      "sum.go": "package legit\n\nfunc Sum(a, b int) int { return a + b }\n",
      "sum_test.go":
        'package legit\n\nimport "testing"\n\nfunc TestSum(t *testing.T) {\n\tif Sum(1, 2) != 3 {\n\t\tt.Fatal("sum")\n\t}\n}\n',
    },
    work: {
      "mul.go": "package legit\n\nfunc Mul(a, b int) int { return a * b }\n",
      "mul_test.go":
        'package legit\n\nimport "testing"\n\nfunc TestMul(t *testing.T) {\n\tif Mul(2, 3) != 6 {\n\t\tt.Fatal("mul")\n\t}\n}\n',
    },
    broken: { "sum.go": "package legit\n\nfunc Sum(a, b int) int { return a - b }\n" },
  },
  cargo: {
    source: "cargo",
    test: "cargo test",
    files: {
      ".gitignore": "target/\n",
      "Cargo.toml": '[package]\nname = "legit"\nversion = "0.1.0"\nedition = "2021"\n',
      "src/lib.rs":
        "pub fn sum(a: i32, b: i32) -> i32 { a + b }\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() { assert_eq!(super::sum(1, 2), 3); }\n}\n",
    },
    work: {
      "src/lib.rs":
        "pub fn sum(a: i32, b: i32) -> i32 { a + b }\npub fn mul(a: i32, b: i32) -> i32 { a * b }\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() { assert_eq!(super::sum(1, 2), 3); }\n    #[test]\n    fn multiplies() { assert_eq!(super::mul(2, 3), 6); }\n}\n",
    },
    broken: {
      "src/lib.rs":
        "pub fn sum(a: i32, b: i32) -> i32 { a - b }\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() { assert_eq!(super::sum(1, 2), 3); }\n}\n",
    },
  },
  pytest: {
    source: "pytest-junit",
    test: "pytest -q -p no:cacheprovider",
    files: {
      ".gitignore": "__pycache__/\n",
      "pytest.ini": "[pytest]\npythonpath = .\n",
      "legit/__init__.py": "def total(a, b):\n    return a + b\n",
      "tests/test_total.py":
        "from legit import total\n\ndef test_adds():\n    assert total(1, 2) == 3\n",
    },
    work: {
      "legit/mul.py": "def mul(a, b):\n    return a * b\n",
      "tests/test_mul.py":
        "from legit.mul import mul\n\ndef test_mul():\n    assert mul(2, 3) == 6\n",
    },
    broken: { "legit/__init__.py": "def total(a, b):\n    return a - b - 1\n" },
  },
  dotnet: {
    source: "dotnet-trx",
    test: "dotnet test Legit.Tests",
    files: {
      ".gitignore": "bin/\nobj/\nTestResults/\n",
      "Legit.Tests/Legit.Tests.csproj":
        '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <IsPackable>false</IsPackable>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.8.0" />\n    <PackageReference Include="xunit" Version="2.6.2" />\n    <PackageReference Include="xunit.runner.visualstudio" Version="2.5.4" />\n  </ItemGroup>\n</Project>\n',
      "Legit.Tests/SumTests.cs":
        "namespace Legit.Tests;\n\npublic class SumTests\n{\n    [Xunit.Fact]\n    public void Adds() => Xunit.Assert.Equal(3, 1 + 2);\n}\n",
    },
    work: {
      "Legit.Tests/MulTests.cs":
        "namespace Legit.Tests;\n\npublic class MulTests\n{\n    [Xunit.Fact]\n    public void Multiplies() => Xunit.Assert.Equal(6, 2 * 3);\n}\n",
    },
    broken: {
      "Legit.Tests/SumTests.cs":
        "namespace Legit.Tests;\n\npublic class SumTests\n{\n    [Xunit.Fact]\n    public void Adds() => Xunit.Assert.Equal(3, 1 - 2);\n}\n",
    },
  },
};

const AVAILABLE: Record<string, boolean> = Object.fromEntries([
  ["vitest", true],
  ["node", true],
  ...(await Promise.all(
    ["go", "cargo", "pytest", "dotnet"].map(async (name) => [name, await has(name)]),
  )),
]);

async function projectRepo(project: Project) {
  return bypassRepo({
    task: { scope: "- everything in the repository", command: project.test },
    files: project.files,
    config: { commands: { test: project.test } },
  });
}

describe.each(Object.keys(PROJECTS))("legitimate work with the real %s runner", (name) => {
  const project = PROJECTS[name] as Project;

  it.skipIf(!AVAILABLE[name])(
    "passes a correct change that adds a tested feature",
    async () => {
      const cwd = await projectRepo(project);
      const run = await next(cwd, ["--yes"], [agent(cwd, project.work), REVIEW_PASS]);
      expect(run.log).not.toContain("Regression:");
      expect(run.code).toBe(0);
      expect(await statusOf(cwd)).toBe("done");
      const capture = await readCapture(cwd, "T-001");
      expect(capture?.baseline?.commands[project.test]?.source).toBe(project.source);
    },
    SLOW,
  );

  it.skipIf(!AVAILABLE[name])(
    "blocks a change that breaks a test",
    async () => {
      const cwd = await projectRepo(project);
      const run = await next(cwd, ["--yes"], [agent(cwd, project.broken), REVIEW_PASS]);
      expect(run.code).toBe(1);
      expect(run.log).toContain("Regression:");
      expect(await statusOf(cwd)).toBe("in_progress");
    },
    SLOW,
  );
});
