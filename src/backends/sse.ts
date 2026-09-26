export type SseEvent = { event: string; data: string };

export async function* readSse(body: AsyncIterable<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, "\n");
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    yield* parts.map(parseEvent).filter((event): event is SseEvent => event !== undefined);
  }
  const last = parseEvent(buffer + decoder.decode());
  if (last) yield last;
}

function parseEvent(block: string): SseEvent | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length > 0 ? { event, data: data.join("\n") } : undefined;
}
