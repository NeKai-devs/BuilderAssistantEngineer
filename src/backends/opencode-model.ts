import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandContext } from "../commands/context.js";
import { readTextIfExists } from "../core/fs.js";
import { parseObject } from "../core/json.js";
import { t } from "../i18n/index.js";

export type OpencodeModel = { model?: string; source?: string };

const CONFIG_NAMES = ["opencode.json", "opencode.jsonc"];
const WEAK = /free|mini|nano|small|lite|tiny|flash|haiku|pickle/i;
const PARAMETERS = /(?:^|[^\d.])(\d+(?:\.\d+)?)b(?:\b|-)/i;
const SMALL_PARAMETERS = 70;

export async function opencodeModel(
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<OpencodeModel> {
  const inline = modelOf(env.OPENCODE_CONFIG_CONTENT);
  if (inline) return { model: inline, source: "OPENCODE_CONFIG_CONTENT" };
  const home = env.HOME || homedir();
  const global = join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode");
  const candidates = [
    ...CONFIG_NAMES.map((name) => join(cwd, name)),
    ...(env.OPENCODE_CONFIG ? [env.OPENCODE_CONFIG] : []),
    ...CONFIG_NAMES.map((name) => join(global, name)),
  ];
  for (const path of candidates) {
    const model = modelOf(await readTextIfExists(path));
    if (model) return { model, source: path.startsWith(cwd) ? path.slice(cwd.length + 1) : path };
  }
  return {};
}

export function isWeakModel(model: string): boolean {
  if (WEAK.test(model)) return true;
  const size = PARAMETERS.exec(model)?.[1];
  return size !== undefined && Number(size) < SMALL_PARAMETERS;
}

export async function noteOpencodeModel(ctx: CommandContext): Promise<void> {
  const { model, source } = await opencodeModel(ctx.cwd, ctx.env);
  if (!model) {
    ctx.prompter.warn(t("opencode.noModel"));
    return;
  }
  if (isWeakModel(model))
    ctx.prompter.warn(t("opencode.weakModel", { model, source: source ?? "" }));
  else ctx.prompter.info(t("opencode.model", { model, source: source ?? "" }));
}

function modelOf(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const model = parseObject(stripComments(text))?.model;
  return typeof model === "string" && model.trim() ? model.trim() : undefined;
}

function stripComments(text: string): string {
  return text
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match, quoted) =>
      quoted ? match : "",
    )
    .replace(/,(\s*[}\]])/g, "$1");
}
