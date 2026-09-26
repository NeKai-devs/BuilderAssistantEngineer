import { extensionOf } from "./files.js";
import { codeFence, truncateText } from "./format.js";

export type Block = { group: string; priority: number; path: string; body: string };
export type Fitted = { blocks: Block[]; omitted: string[] };

const MIN_PARTIAL = 1_000;
const FENCE_SLACK = 8;

export function renderBlock(block: Block): string {
  return `### ${block.path}\n\n${codeFence(block.body, extensionOf(block.path).slice(1))}\n\n`;
}

export function fitBlocks(blocks: Block[], budget: number): Fitted {
  const kept: Block[] = [];
  const omitted: string[] = [];
  let remaining = budget;
  for (const block of [...blocks].sort((a, b) => a.priority - b.priority)) {
    const fitted = fitBlock(block, remaining);
    if (fitted) {
      kept.push(fitted);
      remaining -= renderBlock(fitted).length;
    } else {
      omitted.push(block.path);
    }
  }
  return { blocks: kept, omitted };
}

function fitBlock(block: Block, remaining: number): Block | undefined {
  if (renderBlock(block).length <= remaining) return block;
  if (remaining < MIN_PARTIAL) return undefined;
  const overhead = renderBlock({ ...block, body: "" }).length + FENCE_SLACK;
  return { ...block, body: truncateText(block.body, remaining - overhead) };
}
