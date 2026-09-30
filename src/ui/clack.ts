import * as clack from "@clack/prompts";
import { UserError } from "../core/errors.js";
import { t } from "../i18n/index.js";
import type { Choice, Prompter } from "./prompter.js";

const INTERRUPTED = 130;
const SPINNER_FRAME = 16;
const MIN_ROOM = 20;

export function createClackPrompter(): Prompter {
  return {
    intro: (title) => clack.intro(title),
    outro: (message) => clack.outro(message),
    note: (message, title) => clack.note(message, title),
    info: (message) => clack.log.info(message),
    warn: (message) => clack.log.warn(message),
    success: (message) => clack.log.success(message),
    select: async <T extends string>(message: string, choices: Choice<T>[], initial?: T) =>
      unwrap(
        await clack.select<string>(localized({ message, options: choices, initialValue: initial })),
      ) as T,
    multiselect: async <T extends string>(message: string, choices: Choice<T>[], initial: T[]) =>
      unwrap(
        await clack.multiselect<string>(
          localized({ message, options: choices, initialValues: initial, required: true }),
        ),
      ) as T[],
    text: async (message, placeholder) =>
      unwrap(await clack.text(localized({ message, placeholder }))) ?? "",
    confirm: async (message, initial) =>
      unwrap(await clack.confirm(localized(confirmOptions(message, initial)))),
    canAsk: () => Boolean(process.stdin.isTTY),
    spinner: async (message, task) => {
      if (!process.stdout.isTTY) return staticSpinner(message, task);
      const spin = clack.spinner({ indicator: "timer", cancelMessage: t("ui.interrupted") });
      const interrupted = () => {
        process.exitCode = INTERRUPTED;
      };
      process.on("exit", interrupted);
      const fit = (text: string) => fitLine(text, process.stdout.columns ?? 80);
      spin.start(fit(message));
      try {
        const result = await task((update) => spin.message(fit(update)));
        spin.stop(message);
        return result;
      } catch (error) {
        spin.error(message);
        throw error;
      } finally {
        process.removeListener("exit", interrupted);
      }
    },
  };
}

export function confirmOptions(message: string, initial?: boolean) {
  return { message, initialValue: initial, active: t("ui.yes"), inactive: t("ui.no") };
}

export function localized<T>(options: T): T {
  clack.updateSettings({ messages: { cancel: t("ui.cancelled") } });
  return options;
}

export function fitLine(text: string, columns: number): string {
  const room = Math.max(columns - SPINNER_FRAME, MIN_ROOM);
  return text.length > room ? `${text.slice(0, room - 1)}…` : text;
}

function unwrap<T>(value: T): Exclude<T, symbol> {
  if (clack.isCancel(value)) throw new UserError(t("ui.cancelled"));
  return value as Exclude<T, symbol>;
}

async function staticSpinner<R>(
  message: string,
  task: (update: (message: string) => void) => Promise<R>,
): Promise<R> {
  clack.log.step(message);
  return task(() => {});
}
