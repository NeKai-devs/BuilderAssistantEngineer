import { describe, expect, it } from "vitest";
import { missingTool } from "../../src/gates/absent.js";

describe("missingTool", () => {
  it.each([
    [".venv/bin/python -m mypy", "/repo/.venv/bin/python: No module named mypy\n"],
    ["python3 -m pytest -q", "/usr/bin/python3: No module named pytest"],
    ["npm run typecheck", 'npm error Missing script: "typecheck"\nnpm error A complete log…'],
    ["npm run lint", "npm ERR! missing script: lint"],
    ["npm test", 'npm error Missing script: "test"'],
    ["pnpm run typecheck", " ERR_PNPM_NO_SCRIPT  Missing script: typecheck"],
    ["pnpm lint", 'None of the selected packages has a "lint" script'],
    ["yarn lint", 'error Command "lint" not found.'],
    ["yarn run lint", 'Usage Error: Couldn\'t find a script named "lint".'],
    ["bun run lint", 'error: Script not found "lint"'],
  ])("says `%s` does not exist yet", (command, output) => {
    expect(missingTool(command, output)).toBe(true);
  });

  it.each([
    [".venv/bin/python -m pytest", "E   ModuleNotFoundError: No module named 'app'"],
    [".venv/bin/python -m mypy", "app/main.py:3: error: Incompatible types"],
    ["npm run lint", 'npm error Missing script: "typecheck"'],
    ["npm run typecheck && npm run lint", 'npm error Missing script: "typecheck"'],
    ["npx tsc --noEmit", "npm error could not determine executable to run"],
    ["make lint", "make: *** No rule to make target 'lint'.  Stop."],
    ["go vet ./...", "no Go files in /repo"],
  ])("does not say `%s` is missing when its tool ran", (command, output) => {
    expect(missingTool(command, output)).toBe(false);
  });
});
