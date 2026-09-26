import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UserError } from "../src/core/errors.js";
import { findVariables, loadPrompt, renderPrompt } from "../src/core/prompt-loader.js";
import { tempDir } from "./helpers.js";

const ANALYST_VARS = [
  "mode",
  "project_type",
  "output_language",
  "target_agents",
  "interview",
  "repo_digest",
  "can_explore_repo",
  "prior_plan",
];

describe("prompt loader", () => {
  it("loads the built-in analyst prompt with its declared variables", async () => {
    const prompt = await loadPrompt("analyst", await tempDir());
    expect(prompt.path).toMatch(/prompts[\\/]analyst\.md$/);
    expect(findVariables(prompt.text)).toEqual(ANALYST_VARS);
  });

  it("prefers a user override from .bae/prompts", async () => {
    const cwd = await tempDir();
    await mkdir(join(cwd, ".bae", "prompts"), { recursive: true });
    await writeFile(join(cwd, ".bae", "prompts", "analyst.md"), "Custom {{mode}}");
    const prompt = await loadPrompt("analyst", cwd);
    expect(renderPrompt(prompt, { mode: "PLAN" })).toBe("Custom PLAN");
  });

  it("fails when a variable is missing and lists every missing name", () => {
    const prompt = { path: "x.md", text: "{{a}} {{b}} {{a}} {{c}}" };
    expect(() => renderPrompt(prompt, { b: "1" })).toThrow(UserError);
    expect(() => renderPrompt(prompt, { b: "1" })).toThrow("a, c");
  });

  it("does not expand placeholders inside inserted values", () => {
    const prompt = { path: "x.md", text: "[{{interview}}]" };
    expect(renderPrompt(prompt, { interview: "use {{mode}} here" })).toBe("[use {{mode}} here]");
  });
});
