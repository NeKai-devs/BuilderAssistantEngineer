import { describe, expect, it } from "vitest";
import { fitLine } from "../../src/ui/clack.js";

describe("spinner lines", () => {
  it("keep a progress line on one terminal row, with room for the spinner and its timer", () => {
    const step = `claude is writing the plan (10–40 min) · searching node_modules/{${"a,".repeat(60)}b}`;
    const line = fitLine(step, 150);
    expect(line).toHaveLength(134);
    expect(line.endsWith("…")).toBe(true);
    expect(
      line.startsWith("claude is writing the plan (10–40 min) · searching node_modules/{"),
    ).toBe(true);
  });

  it("leave a line that fits as it is, and never shrink below a readable width", () => {
    expect(fitLine("claude is writing the plan (10–40 min) · thinking", 150)).toBe(
      "claude is writing the plan (10–40 min) · thinking",
    );
    expect(fitLine("x".repeat(40), 10)).toBe(`${"x".repeat(19)}…`);
  });
});
