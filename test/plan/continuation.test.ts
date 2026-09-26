import { describe, expect, it } from "vitest";
import { findTruncation, mergeContinuation } from "../../src/plan/continuation.js";

const block = (marker: string, body: string, end: string) =>
  `<<<${marker}>>>\n${body}\n<<<END ${end}>>>`;

describe("continuation", () => {
  it("detects a response cut inside a block and keeps only complete blocks", () => {
    const text = [
      block("SUMMARY", "s", "SUMMARY"),
      block("FILE: AGENTS.md", "a", "FILE"),
      "<<<FILE: docs/plan/x.md>>>\npartial",
    ].join("\n\n");
    expect(findTruncation(text)).toEqual({
      complete: `${block("SUMMARY", "s", "SUMMARY")}\n\n${block("FILE: AGENTS.md", "a", "FILE")}`,
      marker: "<<<FILE: docs/plan/x.md>>>",
    });
    expect(findTruncation(block("SUMMARY", "s", "SUMMARY"))).toBeUndefined();
  });

  it("appends only new blocks from the continuation and drops chatter", () => {
    const complete = block("FILE: AGENTS.md", "a", "FILE");
    const continuation = `Sure, continuing:\n${block("FILE: AGENTS.md", "again", "FILE")}\n${block("FILE: docs/plan/x.md", "x", "FILE")}\nDone.`;
    expect(mergeContinuation(complete, continuation)).toBe(
      `${complete}\n\n${block("FILE: docs/plan/x.md", "x", "FILE")}`,
    );
  });

  it("keeps a new unfinished block so the next round can continue it", () => {
    const merged = mergeContinuation(block("FILE: A.md", "a", "FILE"), "<<<FILE: B.md>>>\ncut");
    expect(findTruncation(merged)?.marker).toBe("<<<FILE: B.md>>>");
  });
});
