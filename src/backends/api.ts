import { UserError } from "../core/errors.js";
import { asRecord, parseObject } from "../core/json.js";
import { t } from "../i18n/index.js";
import { readSse } from "./sse.js";
import type { Backend, RunOptions } from "./types.js";

export type Env = Record<string, string | undefined>;

export type ApiTarget = {
  provider: "anthropic" | "openai";
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
};

export type ApiDeps = {
  env: Env;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
};

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";
export const ANTHROPIC_MAX_TOKENS = 64_000;

const ANTHROPIC_VERSION = "2023-06-01";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 30_000;
const ERROR_TAIL = 1_000;

const defaultDeps: ApiDeps = {
  env: process.env,
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function createApiBackend(overrides: Partial<ApiDeps> = {}): Backend {
  const deps = { ...defaultDeps, ...overrides };
  return {
    name: "api",
    run: async (prompt, options) => {
      if (options.interactive) throw new UserError(t("backend.apiInteractive"));
      const target = resolveApiTarget(deps.env);
      options.onInfo?.({ model: target.model });
      return target.provider === "anthropic"
        ? callAnthropic(target, prompt, options, deps)
        : callOpenAi(target, prompt, options, deps);
    },
  };
}

export function resolveApiTarget(env: Env): ApiTarget {
  const provider = env.BAE_API_PROVIDER ?? inferProvider(env);
  if (provider === "anthropic") {
    return {
      provider,
      baseUrl: trimSlash(env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"),
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.BAE_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
    };
  }
  if (provider === "openai") {
    const baseUrl = trimSlash(env.OPENAI_BASE_URL ?? "https://api.openai.com/v1");
    if (!env.BAE_MODEL) throw new UserError(t("backend.apiModelRequired", { baseUrl }));
    return { provider, baseUrl, apiKey: env.OPENAI_API_KEY, model: env.BAE_MODEL };
  }
  if (provider === undefined) throw new UserError(t("backend.apiNotConfigured"));
  throw new UserError(t("backend.apiProviderInvalid", { provider }));
}

export function hasApiCredentials(env: Env): boolean {
  return inferProvider(env) !== undefined;
}

function inferProvider(env: Env): string | undefined {
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.OPENAI_API_KEY || env.OPENAI_BASE_URL) return "openai";
  return undefined;
}

async function callAnthropic(
  target: ApiTarget,
  prompt: string,
  options: RunOptions,
  deps: ApiDeps,
): Promise<string> {
  const useFallbacks = target.model === DEFAULT_ANTHROPIC_MODEL;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": target.apiKey ?? "",
    "anthropic-version": ANTHROPIC_VERSION,
    ...(useFallbacks ? { "anthropic-beta": FALLBACK_BETA } : {}),
  };
  const body = {
    model: target.model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    stream: true,
    messages: [{ role: "user", content: prompt }],
    ...(useFallbacks ? { fallbacks: "default" } : {}),
  };
  const response = await post(`${target.baseUrl}/v1/messages`, headers, body, "Anthropic", deps);
  let text = "";
  let stopReason: unknown;
  for await (const { event, data } of readSse(bodyOf(response))) {
    const payload = parseObject(data) ?? {};
    if (event === "error") throw new UserError(apiError("Anthropic", payload));
    const delta = asRecord(payload.delta);
    if (payload.type === "content_block_delta" && delta.type === "text_delta") {
      const chunk = String(delta.text ?? "");
      text += chunk;
      options.stream?.(chunk);
    }
    if (payload.type === "message_delta") stopReason = delta.stop_reason;
  }
  if (stopReason === "refusal") throw new UserError(t("backend.refusal"));
  if (stopReason === "max_tokens") throw new UserError(t("backend.truncated"));
  options.onInfo?.({ truncated: false });
  return text;
}

async function callOpenAi(
  target: ApiTarget,
  prompt: string,
  options: RunOptions,
  deps: ApiDeps,
): Promise<string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {}),
  };
  const body = {
    model: target.model,
    stream: true,
    messages: [{ role: "user", content: prompt }],
  };
  const response = await post(`${target.baseUrl}/chat/completions`, headers, body, "OpenAI", deps);
  let text = "";
  let finishReason: unknown;
  for await (const { data } of readSse(bodyOf(response))) {
    if (data.trim() === "[DONE]") break;
    const payload = parseObject(data) ?? {};
    if (payload.error) throw new UserError(apiError("OpenAI", payload));
    const choice = asRecord(Array.isArray(payload.choices) ? payload.choices[0] : undefined);
    const content = asRecord(choice.delta).content;
    if (typeof content === "string") {
      text += content;
      options.stream?.(content);
    }
    finishReason = choice.finish_reason ?? finishReason;
  }
  if (finishReason === "length") throw new UserError(t("backend.truncated"));
  options.onInfo?.({ truncated: false });
  return text;
}

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  provider: string,
  deps: ApiDeps,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await send(url, headers, body, deps);
    if (response.ok) return response;
    if (!RETRYABLE.has(response.status) || attempt >= MAX_RETRIES) {
      const details = (await response.text()).slice(0, ERROR_TAIL);
      throw new UserError(t("backend.apiHttp", { provider, status: response.status, details }));
    }
    await deps.sleep(retryDelay(response, attempt));
  }
}

async function send(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  deps: ApiDeps,
): Promise<Response> {
  try {
    return await deps.fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new UserError(t("backend.apiNetwork", { url, details }));
  }
}

function retryDelay(response: Response, attempt: number): number {
  const header = Number(response.headers.get("retry-after"));
  const seconds = Number.isFinite(header) && header > 0 ? header : 2 ** (attempt + 1);
  return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS);
}

function bodyOf(response: Response): AsyncIterable<Uint8Array> {
  if (!response.body) return (async function* () {})();
  return response.body as unknown as AsyncIterable<Uint8Array>;
}

function apiError(provider: string, payload: Record<string, unknown>): string {
  const error = asRecord(payload.error);
  const details = String(error.message ?? JSON.stringify(payload));
  return t("backend.apiHttp", { provider, status: String(error.type ?? "stream"), details });
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
