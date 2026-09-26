import * as clack from "@clack/prompts";
import { UserError } from "../core/errors.js";
import { t } from "../i18n/index.js";
import type { Choice, Prompter } from "./prompter.js";

export function createClackPrompter(): Prompter {
  return {
    intro: (title) => clack.intro(title),
    outro: (message) => clack.outro(message),
    note: (message, title) => clack.note(message, title),
    info: (message) => clack.log.info(message),
    warn: (message) => clack.log.warn(message),
    success: (message) => clack.log.success(message),
    select: async <T extends string>(message: string, choices: Choice<T>[], initial?: T) =>
      unwrap(await clack.select<string>({ message, options: choices, initialValue: initial })) as T,
    multiselect: async <T extends string>(message: string, choices: Choice<T>[], initial: T[]) =>
      unwrap(
        await clack.multiselect<string>({
          message,
          options: choices,
          initialValues: initial,
          required: true,
        }),
      ) as T[],
    text: async (message, placeholder) => unwrap(await clack.text({ message, placeholder })) ?? "",
    confirm: async (message, initial) =>
      unwrap(await clack.confirm({ message, initialValue: initial })),
    spinner: async (message, task) => {
      const spin = clack.spinner();
      spin.start(message);
      try {
        const result = await task();
        spin.stop(message);
        return result;
      } catch (error) {
        spin.error(message);
        throw error;
      }
    },
  };
}

function unwrap<T>(value: T): Exclude<T, symbol> {
  if (clack.isCancel(value)) throw new UserError(t("ui.cancelled"));
  return value as Exclude<T, symbol>;
}
