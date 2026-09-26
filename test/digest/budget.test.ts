import { describe, expect, it } from "vitest";
import { type Block, fitBlocks, renderBlock } from "../../src/digest/budget.js";
import { TRUNCATION_MARK } from "../../src/digest/format.js";

const block = (path: string, priority: number, size: number): Block => ({
  group: `p${priority}`,
  priority,
  path,
  body: "x".repeat(size),
});

describe("fitBlocks", () => {
  it("keeps higher priority blocks first and lists the omitted ones", () => {
    const blocks = [
      block("doc.md", 3, 500),
      block("package.json", 1, 500),
      block("main.ts", 2, 500),
    ];
    const budget = renderBlock(blocks[1] as Block).length + renderBlock(blocks[2] as Block).length;
    const fitted = fitBlocks(blocks, budget);
    expect(fitted.blocks.map((b) => b.path)).toEqual(["package.json", "main.ts"]);
    expect(fitted.omitted).toEqual(["doc.md"]);
  });

  it("truncates a block that only partly fits and stays within budget", () => {
    const fitted = fitBlocks([block("package.json", 1, 5_000)], 2_000);
    const kept = fitted.blocks[0] as Block;
    expect(kept.body.endsWith(TRUNCATION_MARK)).toBe(true);
    expect(renderBlock(kept).length).toBeLessThanOrEqual(2_000);
  });

  it("uses a longer fence when the body contains backticks", () => {
    expect(
      renderBlock({ group: "g", priority: 1, path: "README.md", body: "```js\nx\n```" }),
    ).toContain("````md\n```js");
  });
});
