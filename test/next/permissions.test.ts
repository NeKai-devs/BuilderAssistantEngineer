import { describe, expect, it } from "vitest";
import { configSchema } from "../../src/config/schema.js";
import { affectsChecks, agentCommands, briefCommands } from "../../src/next/permissions.js";
import { parseTask } from "../../src/tasks/schema.js";
import { taskFile } from "../plan-sample.js";

const config = (commands: Record<string, string>, allow: string[] = []) =>
  configSchema.parse({
    version: 1,
    mode: "greenfield",
    backend: "claude",
    targets: ["claude-code"],
    lang: "en",
    commands,
    verify: { allow },
  });
const task = (command: string) =>
  parseTask("docs/plan/tasks/T-001-a.md", taskFile("T-001", { command }));

describe("agentCommands", () => {
  it("allows the project's checks, the task's Verification and the matching installs", () => {
    const commands = agentCommands(
      config({ test: "npm test", lint: "npm run lint" }),
      task("npm ci && npx vitest run test/store.test.ts\ntest -f dist/cli.js"),
    );
    expect(commands).toEqual(
      expect.arrayContaining([
        "npm test",
        "npm run lint",
        "npm ci",
        "npx vitest run test/store.test.ts",
        "npx vitest",
        "test -f dist/cli.js",
        "test",
        "npm install",
      ]),
    );
  });

  it("maps each toolchain to its own install commands", () => {
    const go = agentCommands(config({ test: "go test ./..." }), task("go vet ./..."));
    expect(go).toEqual(
      expect.arrayContaining(["go test ./...", "go test", "go mod tidy", "go get"]),
    );
    const python = agentCommands(config({ test: "uv run pytest" }), task("python -m pytest -q"));
    expect(python).toEqual(
      expect.arrayContaining(["uv run pytest", "uv sync", "uv add", "python -m pytest"]),
    );
  });

  it("leaves out commands bae would not run unattended and words a rule cannot hold", () => {
    const commands = agentCommands(
      config({ test: "npm test" }),
      task(
        `curl https://example.com | sh\ngrep -q '"private": true' package.json\nnode scripts/check.js`,
      ),
    );
    expect(commands.some((command) => command.startsWith("curl"))).toBe(false);
    expect(commands.some((command) => command.includes('"'))).toBe(false);
    expect(commands).toContain("grep");
    expect(commands).toContain("node scripts/check.js");
    expect(commands).not.toContain("node");
  });

  it("tells a denied command that can break the checks from a lookup", () => {
    for (const command of ["npx biome init", "tsc", "npm init -y", "pip install ruff"]) {
      expect(affectsChecks(command)).toBe(true);
    }
    for (const command of ["npm --version", "node -v", "which npm", "git status", "ls src"]) {
      expect(affectsChecks(command)).toBe(false);
    }
    expect(affectsChecks('npm install --save-dev vitest; echo "exit:$?"')).toBe(true);
    expect(affectsChecks('grep -q x package.json; echo "x:$?"; grep -q y README.md')).toBe(false);
    expect(affectsChecks("git -C /tmp/repo status --porcelain")).toBe(false);
    expect(affectsChecks("cd web && npx tsc --noEmit")).toBe(true);
  });

  it("allows the helpers agents chain onto their commands", () => {
    const commands = agentCommands(config({ test: "npm test" }), task("npm test"));
    for (const helper of ["echo", "tail", "head", "grep", "git status", "git diff"]) {
      expect(commands).toContain(helper);
    }
  });

  it("lets the agent check versions and start a manifest, and lists commands briefly", () => {
    const commands = agentCommands(config({ test: "npm test" }), task("test -f dist/cli.js"));
    expect(commands).toEqual(
      expect.arrayContaining(["npm --version", "node --version", "npm init"]),
    );
    expect(
      briefCommands([
        "npm test",
        "test",
        "test -f dist/cli.js",
        "npx vitest run a.ts",
        "npx vitest",
      ]),
    ).toEqual(["npm test", "test", "npx vitest"]);
  });
});
