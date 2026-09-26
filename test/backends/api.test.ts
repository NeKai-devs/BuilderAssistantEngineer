import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_MAX_TOKENS,
  createApiBackend,
  DEFAULT_ANTHROPIC_MODEL,
  resolveApiTarget,
} from "../../src/backends/api.js";

type Request = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function sse(events: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

function anthropicEvents(texts: string[], stopReason = "end_turn"): string[] {
  return [
    'event: message_start\ndata: {"type":"message_start","message":{}}\n\n',
    ...texts.map(
      (text) =>
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`,
    ),
    `event: message_delta\r\ndata: {"type":"message_delta","delta":{"stop_reason":"${stopReason}"}}\r\n\r\n`,
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
}

function fakeFetch(responses: Response[]) {
  const requests: Request[] = [];
  const fetch = async (url: string | URL | globalThis.Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    const response = responses.shift();
    if (!response) throw new Error("no more responses");
    return response;
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const noSleep = async () => {};

describe("api backend", () => {
  it("streams an Anthropic answer with fallbacks on the default model", async () => {
    const { fetch, requests } = fakeFetch([sse(anthropicEvents(["Hel", "lo"]))]);
    const chunks: string[] = [];
    const backend = createApiBackend({ env: { ANTHROPIC_API_KEY: "key" }, fetch, sleep: noSleep });
    expect(await backend.run("PROMPT", { cwd: ".", stream: (c) => chunks.push(c) })).toBe("Hello");
    expect(chunks).toEqual(["Hel", "lo"]);
    const [request] = requests;
    expect(request?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request?.headers).toMatchObject({
      "x-api-key": "key",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    });
    expect(request?.body).toEqual({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      stream: true,
      messages: [{ role: "user", content: "PROMPT" }],
      fallbacks: "default",
    });
  });

  it("omits fallbacks for a custom model", async () => {
    const { fetch, requests } = fakeFetch([sse(anthropicEvents(["ok"]))]);
    const env = { ANTHROPIC_API_KEY: "key", BAE_MODEL: "claude-sonnet-5" };
    await createApiBackend({ env, fetch, sleep: noSleep }).run("P", { cwd: "." });
    expect(requests[0]?.body.fallbacks).toBeUndefined();
    expect(requests[0]?.headers["anthropic-beta"]).toBeUndefined();
  });

  it("fails clearly on refusal, truncation and stream errors", async () => {
    const env = { ANTHROPIC_API_KEY: "key" };
    const refusal = fakeFetch([sse(anthropicEvents(["partial"], "refusal"))]).fetch;
    await expect(
      createApiBackend({ env, fetch: refusal, sleep: noSleep }).run("P", { cwd: "." }),
    ).rejects.toThrow("declined");
    const truncated = fakeFetch([sse(anthropicEvents(["partial"], "max_tokens"))]).fetch;
    await expect(
      createApiBackend({ env, fetch: truncated, sleep: noSleep }).run("P", { cwd: "." }),
    ).rejects.toThrow("token limit");
    const errored = fakeFetch([
      sse([
        'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
      ]),
    ]).fetch;
    await expect(
      createApiBackend({ env, fetch: errored, sleep: noSleep }).run("P", { cwd: "." }),
    ).rejects.toThrow("Overloaded");
  });

  it("retries retryable HTTP errors and reports the final one", async () => {
    const env = { ANTHROPIC_API_KEY: "key" };
    const recovered = fakeFetch([
      new Response("busy", { status: 529 }),
      sse(anthropicEvents(["ok"])),
    ]);
    const delays: number[] = [];
    const sleep = async (ms: number) => {
      delays.push(ms);
    };
    expect(
      await createApiBackend({ env, fetch: recovered.fetch, sleep }).run("P", { cwd: "." }),
    ).toBe("ok");
    expect(delays).toEqual([2_000]);
    const denied = fakeFetch([
      new Response('{"error":"invalid x-api-key"}', { status: 401 }),
    ]).fetch;
    await expect(
      createApiBackend({ env, fetch: denied, sleep }).run("P", { cwd: "." }),
    ).rejects.toThrow(/401.*invalid x-api-key/);
  });

  it("streams from an OpenAI-compatible endpoint without a key", async () => {
    const chunk = (content: string, finish: string | null = null) =>
      `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`;
    const { fetch, requests } = fakeFetch([
      sse([chunk("Ho"), chunk("la", "stop"), "data: [DONE]\n\n"]),
    ]);
    const env = { OPENAI_BASE_URL: "http://localhost:11434/v1/", BAE_MODEL: "llama3.3" };
    expect(await createApiBackend({ env, fetch, sleep: noSleep }).run("P", { cwd: "." })).toBe(
      "Hola",
    );
    expect(requests[0]?.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(requests[0]?.headers.authorization).toBeUndefined();
    expect(requests[0]?.body).toEqual({
      model: "llama3.3",
      stream: true,
      messages: [{ role: "user", content: "P" }],
    });
  });

  it("resolves the provider from the environment", () => {
    expect(resolveApiTarget({ ANTHROPIC_API_KEY: "a" }).provider).toBe("anthropic");
    expect(resolveApiTarget({ OPENAI_API_KEY: "o", BAE_MODEL: "m" }).provider).toBe("openai");
    expect(
      resolveApiTarget({ BAE_API_PROVIDER: "openai", ANTHROPIC_API_KEY: "a", BAE_MODEL: "m" })
        .provider,
    ).toBe("openai");
    expect(() => resolveApiTarget({})).toThrow("ANTHROPIC_API_KEY");
    expect(() => resolveApiTarget({ OPENAI_API_KEY: "o" })).toThrow("BAE_MODEL");
    expect(() => resolveApiTarget({ BAE_API_PROVIDER: "gemini" })).toThrow("gemini");
  });

  it("refuses interactive sessions", async () => {
    const backend = createApiBackend({ env: { ANTHROPIC_API_KEY: "k" }, sleep: noSleep });
    await expect(backend.run("P", { cwd: ".", interactive: true })).rejects.toThrow("interactive");
  });
});
