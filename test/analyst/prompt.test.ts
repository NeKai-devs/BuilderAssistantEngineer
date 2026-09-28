import { describe, expect, it } from "vitest";
import { buildAnalystPrompt } from "../../src/analyst/prompt.js";
import { tempDir } from "../helpers.js";

describe("buildAnalystPrompt", () => {
  it("fills every analyst variable and delimits long inputs", async () => {
    const prompt = await buildAnalystPrompt(await tempDir(), {
      mode: "PLAN",
      projectType: "brownfield",
      lang: "es",
      targets: ["claude-code", "codex"],
      interview: "# Interview",
      digest: "# Repository digest",
      canExplore: true,
      priorPlan: "",
    });
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
    expect(prompt).toContain("- MODE: PLAN");
    expect(prompt).toContain("- OUTPUT_LANGUAGE: Spanish");
    expect(prompt).toContain("- TARGET_AGENTS: claude-code, codex");
    expect(prompt).toContain("<interview>\n# Interview\n</interview>");
    expect(prompt).toContain("<repo_digest>\n# Repository digest\n</repo_digest>");
    expect(prompt).toContain("<prior_plan>\n(empty)\n</prior_plan>");
    expect(prompt).toContain("- CAN_EXPLORE_REPO: true");
    expect(prompt).toContain("Each item must be reachable by changing only the files In Scope");
    expect(prompt).toContain("is not a criterion: put it under Risks and notes.");
    expect(prompt).toContain("starting with a verb (Add, Expose, Fix), never with an acronym");
  });
});
