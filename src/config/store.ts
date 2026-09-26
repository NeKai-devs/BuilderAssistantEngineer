import { relative } from "node:path";
import { z } from "zod";
import { UserError } from "../core/errors.js";
import { readTextIfExists, writeText } from "../core/fs.js";
import { baePaths } from "../core/paths.js";
import { t } from "../i18n/index.js";
import { type Config, type ConfigInput, configSchema } from "./schema.js";

export async function readConfig(cwd: string): Promise<Config | undefined> {
  const path = baePaths(cwd).config;
  const text = await readTextIfExists(path);
  if (text === undefined) return undefined;
  return parseConfig(text, relative(cwd, path));
}

export function parseConfig(text: string, displayPath: string): Config {
  const result = configSchema.safeParse(parseJson(text, displayPath));
  if (result.success) return result.data;
  throw new UserError(
    t("error.configInvalid", { path: displayPath, details: z.prettifyError(result.error) }),
  );
}

export async function writeConfig(cwd: string, config: ConfigInput): Promise<void> {
  await writeText(baePaths(cwd).config, `${JSON.stringify(config, null, 2)}\n`);
}

export function readInterview(cwd: string): Promise<string | undefined> {
  return readTextIfExists(baePaths(cwd).interview);
}

export async function writeInterview(cwd: string, text: string): Promise<void> {
  await writeText(baePaths(cwd).interview, text.endsWith("\n") ? text : `${text}\n`);
}

function parseJson(text: string, displayPath: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new UserError(t("error.configJson", { path: displayPath, details }));
  }
}
