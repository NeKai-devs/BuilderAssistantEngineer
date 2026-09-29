import { describe, expect, it } from "vitest";
import { claudeProgress } from "../../src/backends/claude-stream.js";
import type { Progress } from "../../src/backends/types.js";

const line = (event: unknown) => `${JSON.stringify(event)}\n`;

describe("claudeProgress", () => {
  it("turns stream-json events into steps as they arrive, even split across chunks", () => {
    const seen: Progress[] = [];
    const feed = claudeProgress("/repo", (progress) => seen.push(progress));
    const events = [
      line({ type: "system", subtype: "init" }),
      line({
        type: "stream_event",
        event: { type: "content_block_start", content_block: { type: "thinking" } },
      }),
      line({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/repo/src/app.ts" } },
            { type: "tool_use", name: "Grep", input: { pattern: "createServer" } },
            { type: "tool_use", name: "Bash", input: { command: "npm   test\n  -- --run" } },
          ],
        },
      }),
      line({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "<<<FILE: a" } },
      }),
      line({ type: "result", total_cost_usd: 0.5 }),
    ].join("");
    for (let index = 0; index < events.length; index += 37) feed(events.slice(index, index + 37));
    expect(seen).toEqual([
      { type: "thinking" },
      { type: "tool", tool: "Read", detail: "src/app.ts" },
      { type: "tool", tool: "Grep", detail: "createServer" },
      { type: "tool", tool: "Bash", detail: "npm test -- --run" },
      { type: "text", text: "<<<FILE: a" },
    ]);
  });
});
