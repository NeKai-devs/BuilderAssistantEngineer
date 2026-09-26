import { MARKER } from "./parser.js";

export type RawBlock = { key: string; raw: string; closed: boolean };
export type Truncation = { complete: string; marker: string };

export function rawBlocks(text: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  let open: { marker: string; start: number } | undefined;
  for (const match of text.matchAll(MARKER)) {
    const marker = match[1] ?? "";
    const index = match.index ?? 0;
    if (marker.startsWith("END ")) {
      if (open && marker.slice(4) === kindOf(open.marker)) {
        const end = index + match[0].length;
        blocks.push({ key: open.marker, raw: text.slice(open.start, end).trim(), closed: true });
      }
      open = undefined;
    } else if (!open) {
      open = { marker, start: index };
    }
  }
  if (open) blocks.push({ key: open.marker, raw: text.slice(open.start).trim(), closed: false });
  return blocks;
}

export function findTruncation(text: string): Truncation | undefined {
  const last = rawBlocks(text).at(-1);
  if (!last || last.closed) return undefined;
  const complete = rawBlocks(text)
    .filter((block) => block.closed)
    .map((block) => block.raw)
    .join("\n\n");
  return { complete, marker: `<<<${last.key}>>>` };
}

export function mergeContinuation(complete: string, continuation: string): string {
  const seen = new Set(rawBlocks(complete).map((block) => block.key));
  const extra = rawBlocks(continuation).filter((block) => !seen.has(block.key));
  return [complete, ...extra.map((block) => block.raw)].filter(Boolean).join("\n\n");
}

function kindOf(marker: string): string {
  return marker.startsWith("FILE:") ? "FILE" : marker;
}
