import { CLI } from "../core/invoked.js";
import { en, type MessageKey, type Messages } from "./en.js";
import { es } from "./es.js";

export const LANGS = ["en", "es"] as const;
export type Lang = (typeof LANGS)[number];
export type { MessageKey };

const catalogs: Record<Lang, Messages> = { en, es };
const PLACEHOLDER = /\{\{(\w+)\}\}/g;
const DEFAULTS: Record<string, string> = { cli: CLI };

let current: Lang = "en";

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

export function isLang(value: unknown): value is Lang {
  return LANGS.some((lang) => lang === value);
}

export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  return catalogs[current][key].replace(PLACEHOLDER, (match, name: string) =>
    String(vars[name] ?? DEFAULTS[name] ?? match),
  );
}
