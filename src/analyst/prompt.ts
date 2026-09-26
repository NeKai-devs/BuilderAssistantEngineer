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

export async function buildAnalystPrompt(cwd: string, input: AnalystInput): Promise<string> {
  const prompt = await loadPrompt("analyst", cwd);
  return renderPrompt(prompt, {
    mode: input.mode,
    project_type: input.projectType,
    output_language: LANGUAGE_NAMES[input.lang],
    target_agents: input.targets.join(", "),
    interview: wrap("interview", input.interview),
    repo_digest: wrap("repo_digest", input.digest),
    can_explore_repo: String(input.canExplore),
    prior_plan: wrap("prior_plan", input.priorPlan),
  });
}

function wrap(tag: string, value: string): string {
  const body = value.trim() || "(empty)";
  return `\n<${tag}>\n${body}\n</${tag}>\n`;
}
