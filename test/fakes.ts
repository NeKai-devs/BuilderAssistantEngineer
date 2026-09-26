import type { Backend, RunOptions } from "../src/backends/types.js";
import type { Backend as BackendName } from "../src/config/schema.js";
import type { Prompter } from "../src/ui/prompter.js";

export function fakePrompter(answers: unknown[]) {
  const queue = [...answers];
  const log: string[] = [];
  const asked: string[] = [];
  const next = (message: string): unknown => {
    asked.push(message);
    if (queue.length === 0) throw new Error(`no scripted answer for: ${message}`);
    return queue.shift();
  };
  const prompter: Prompter = {
    intro: (message) => log.push(`intro: ${message}`),
    outro: (message) => log.push(`outro: ${message}`),
    note: (message, title) => log.push(`note: ${title ?? ""} ${message}`),
    info: (message) => log.push(`info: ${message}`),
    warn: (message) => log.push(`warn: ${message}`),
    success: (message) => log.push(`success: ${message}`),
    select: async (message, choices) => {
      const answer = next(message);
      if (!choices.some((choice) => choice.value === answer)) {
        throw new Error(`invalid choice ${String(answer)} for: ${message}`);
      }
      return answer as never;
    },
    multiselect: async (message) => next(message) as never,
    text: async (message) => String(next(message) ?? ""),
    confirm: async (message) => Boolean(next(message)),
    spinner: async (_message, task) => task(() => {}),
  };
  return { prompter, log, asked, remaining: () => queue.length };
}

export function fakeBackend(replies: string[], name: BackendName = "claude") {
  const queue = [...replies];
  const prompts: string[] = [];
  const backend: Backend = {
    name,
    run: async (prompt) => {
      prompts.push(prompt);
      const reply = queue.shift();
      if (reply === undefined) throw new Error("no scripted reply");
      return reply;
    },
  };
  return { backend, prompts };
}

export type Step = (prompt: string, options: RunOptions) => string | Promise<string>;

export function scriptedBackend(steps: Step[], name: BackendName = "claude") {
  const queue = [...steps];
  const calls: { prompt: string; options: RunOptions }[] = [];
  const backend: Backend = {
    name,
    run: async (prompt, options) => {
      calls.push({ prompt, options });
      const step = queue.shift();
      if (!step) throw new Error("no scripted step");
      return step(prompt, options);
    },
  };
  return { backend, calls };
}
