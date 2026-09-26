import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../i18n/index.js";
import { UserError } from "./errors.js";
import { readTextIfExists } from "./fs.js";
import { baePaths } from "./paths.js";

const BUILTIN_DIR = fileURLToPath(new URL("../prompts/", import.meta.url));
const VARIABLE = /\{\{(\w+)\}\}/g;

export type Prompt = { path: string; text: string };

export async function loadPrompt(name: string, cwd: string): Promise<Prompt> {
  const overridePath = join(baePaths(cwd).prompts, `${name}.md`);
  const override = await readTextIfExists(overridePath);
  if (override !== undefined) return { path: overridePath, text: override };
  const path = join(BUILTIN_DIR, `${name}.md`);
  return { path, text: await readFile(path, "utf8") };
}

export function renderPrompt(prompt: Prompt, vars: Record<string, string>): string {
  const missing = findVariables(prompt.text).filter((name) => !Object.hasOwn(vars, name));
  if (missing.length > 0) {
    throw new UserError(
      t("error.promptMissingVars", { path: prompt.path, vars: missing.join(", ") }),
    );
  }
  return prompt.text.replace(VARIABLE, (_, name: string) => vars[name] ?? "");
}

export function findVariables(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(VARIABLE), (match) => match[1] ?? ""))];
}
