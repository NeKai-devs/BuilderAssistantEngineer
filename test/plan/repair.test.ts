import { describe, expect, it } from "vitest";
import { parsePlan } from "../../src/plan/parser.js";
import { repairPlan } from "../../src/plan/repair.js";
import { planOutput } from "../plan-sample.js";

describe("repairPlan", () => {
  it("normalizes markers with extra spaces or lowercase and leaves valid ones alone", () => {
    const text = [
      "<<< SUMMARY >>>",
      "s",
      "<<<end summary>>>",
      "<<<FILE:AGENTS.md>>>",
      "Mentions <<< FILE: x >>> inline.",
      "<<<END  FILE>>>",
      "<<< file : docs/plan/a.md >>>",
      "a",
      "<<<END FILE>>>",
    ].join("\n");
    const { text: fixed, repairs } = repairPlan(text, undefined);
    expect(fixed.split("\n")).toEqual([
      "<<<SUMMARY>>>",
      "s",
      "<<<END SUMMARY>>>",
      "<<<FILE:AGENTS.md>>>",
      "Mentions <<< FILE: x >>> inline.",
      "<<<END FILE>>>",
      "<<<FILE: docs/plan/a.md>>>",
      "a",
      "<<<END FILE>>>",
    ]);
    expect(repairs).toEqual(["normalized 4 marker(s) with extra spaces or lowercase"]);
  });

  it("closes the last FILE block only when the answer was not cut off", () => {
    const text = planOutput().replace(/<<<END FILE>>>$/, "");
    expect(repairPlan(text, true)).toEqual({ text, repairs: [] });
    expect(repairPlan(text, undefined)).toEqual({ text, repairs: [] });
    const repaired = repairPlan(text, false);
    expect(repaired.repairs).toEqual([
      "closed the last FILE block (.claude/commands/next.md) that was missing <<<END FILE>>>",
    ]);
    expect(parsePlan(repaired.text).files).toHaveLength(8);
    expect(repairPlan(planOutput(), false).repairs).toEqual([]);
  });
});
