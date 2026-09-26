import { describe, expect, it } from "vitest";
import { fillCommands, proposeCommands } from "../../src/config/commands.js";
import { copyFixture, tempDir, writeFiles } from "../helpers.js";

describe("proposeCommands", () => {
  it("uses package.json scripts with the detected package manager", async () => {
    expect(await proposeCommands(await copyFixture("node-app"))).toEqual({
      test: "npm test",
      lint: "npm run lint",
      build: "npm run build",
    });
    const cwd = await tempDir();
    await writeFiles(cwd, {
      "package.json": JSON.stringify({
        scripts: { test: "vitest run", typecheck: "tsc --noEmit" },
        packageManager: "pnpm@9.0.0",
      }),
    });
    expect(await proposeCommands(cwd)).toEqual({
      test: "pnpm test",
      typecheck: "pnpm run typecheck",
    });
  });

  it("skips npm's placeholder test script and falls back to Makefile targets", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, {
      "package.json": JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      }),
      "yarn.lock": "",
      Makefile: "test:\n\tnode --test\nlint:\n\tbiome check .\n",
    });
    expect(await proposeCommands(cwd)).toEqual({ test: "make test", lint: "make lint" });
  });

  it("infers Python tools from pyproject and Go defaults from go.mod", async () => {
    expect(await proposeCommands(await copyFixture("python-app"))).toEqual({
      test: "pytest",
      lint: "ruff check .",
    });
    expect(await proposeCommands(await copyFixture("go-service"))).toEqual({
      test: "go test ./...",
      lint: "go vet ./...",
      build: "go build ./...",
    });
    expect(await proposeCommands(await copyFixture("docs-only"))).toEqual({});
  });
});

describe("fillCommands", () => {
  it("keeps the first value for each command", () => {
    expect(
      fillCommands(
        { test: "make test" },
        { test: "npm test", lint: "  " },
        { lint: "npm run lint", build: "npm run build" },
      ),
    ).toEqual({ test: "make test", lint: "npm run lint", build: "npm run build" });
  });
});
