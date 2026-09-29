import { CLI } from "../commands/shared.js";
import type { Mode, Target } from "../config/schema.js";
import { loadPrompt, renderPrompt } from "../core/prompt-loader.js";
import type { Lang } from "../i18n/index.js";

export type AnalystInput = {
  mode: "INTERVIEW" | "PLAN";
  projectType: Mode;
  lang: Lang;
  targets: Target[];
  interview: string;
  digest: string;
  canExplore: boolean;
  priorPlan: string;
};

export const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", es: "Spanish" };

export type AnalystPrompt = { system: string; request: string };

const IN_REQUEST = "given in REQUEST at the end";

export async function buildAnalystPrompt(cwd: string, input: AnalystInput): Promise<AnalystPrompt> {
  const prompt = await loadPrompt("analyst", cwd);
  const system = renderPrompt(prompt, {
    mode: IN_REQUEST,
    project_type: input.projectType,
    output_language: LANGUAGE_NAMES[input.lang],
    target_agents: input.targets.join(", "),
    interview: IN_REQUEST,
    repo_digest: wrap("repo_digest", input.digest),
    can_explore_repo: String(input.canExplore),
    prior_plan: IN_REQUEST,
    cli: CLI,
  });
  const request = [
    "## REQUEST",
    `- MODE: ${input.mode}`,
    `- INTERVIEW:${wrap("interview", input.interview)}`,
    `- PRIOR_PLAN:${wrap("prior_plan", input.priorPlan)}`,
    `Work in MODE = ${input.mode}, following the instructions above.`,
  ].join("\n");
  return { system: system.trimEnd(), request };
}

export function wholePrompt(prompt: AnalystPrompt): string {
  return `${prompt.system}\n\n${prompt.request}`;
}

function wrap(tag: string, value: string): string {
  const body = value.trim() || "(empty)";
  return `\n<${tag}>\n${body}\n</${tag}>\n`;
}
