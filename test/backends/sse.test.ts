import { describe, expect, it } from "vitest";
import { readSse } from "../../src/backends/sse.js";

async function* chunks(...parts: string[]) {
  const encoder = new TextEncoder();
  for (const part of parts) yield encoder.encode(part);
}

describe("readSse", () => {
  it("joins events split across chunks and handles CRLF and multi-line data", async () => {
    const events = [];
    for await (const event of readSse(
      chunks("event: a\r\ndata: 1", "\r\n\r\n: ping\n\ndata: x\ndata: y\n\n", "data: tail"),
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      { event: "a", data: "1" },
      { event: "message", data: "x\ny" },
      { event: "message", data: "tail" },
    ]);
  });
});
