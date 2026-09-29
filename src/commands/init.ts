import { wholePrompt } from "../analyst/prompt.js";
import type { AgentName } from "../backends/agent-cli.js";
import { hasApiCredentials } from "../backends/api.js";
import { noteOpencodeModel } from "../backends/opencode-model.js";
import {
  type Backend as BackendName,
  type Config,
  DEFAULT_AGENT_TIMEOUT_MINUTES,
  DEFAULT_CHECK_TIMEOUT_MINUTES,
  DEFAULT_DIGEST_MAX_CHARS,
  MODES,
  type Mode,
  TARGETS,
  type Target,
} from "../config/schema.js";
import { readConfig, readInterview, writeConfig, writeInterview } from "../config/store.js";
import { UserError } from "../core/errors.js";
import { ensureGitignore } from "../core/gitignore.js";
import { AGENT_BACKENDS, detectInstalledAgents, pickDefaultBackend } from "../detect/agents.js";
import { detectProjectMode } from "../detect/mode.js";
import { buildDigest } from "../digest/index.js";
import { getLang, type Lang, setLang, t } from "../i18n/index.js";
import { interviewPrompt, runAdaptiveRound } from "../interview/adaptive.js";
import { type Brief, loadBrief } from "../interview/brief.js";
import { BASE_QUESTIONS, OBJECTIVE_LABELS, OBJECTIVES } from "../interview/questions.js";
import { type InterviewData, renderInterview } from "../interview/render.js";
import type { Choice } from "../ui/prompter.js";
import type { CommandContext } from "./context.js";

export type InitOptions = { brief?: string };

export const NEXT_COMMAND = "npx builder-assistant-engineer plan";

const BACKEND_LABELS: Record<AgentName, string> = {
  claude: "Claude Code",
  opencode: "opencode",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
};

const TARGET_LABELS: Record<Target, string> = {
  "claude-code": "Claude Code",
  opencode: "opencode",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
};

const TARGET_FOR: Record<AgentName, Target> = {
  claude: "claude-code",
  opencode: "opencode",
  codex: "codex",
  gemini: "gemini",
};

export async function runInit(ctx: CommandContext, options: InitOptions): Promise<void> {
  const existing = await readConfig(ctx.cwd);
  ctx.prompter.intro(t("init.intro"));
  const lang = await chooseLang(ctx, existing);
  setLang(lang);
  const mode = await chooseMode(ctx, await detectProjectMode(ctx.cwd));
  const installed = await detectInstalledAgents(ctx.env);
  const config: Config = {
    version: 1,
    mode,
    backend: await chooseBackend(ctx, installed, existing),
    targets: await chooseTargets(ctx, installed, existing),
    lang,
    digest: existing?.digest ?? { maxChars: DEFAULT_DIGEST_MAX_CHARS },
    commands: existing?.commands ?? {},
    gates: existing?.gates ?? { regression: "full", timeoutMinutes: DEFAULT_CHECK_TIMEOUT_MINUTES },
    verify: existing?.verify ?? { allow: [] },
    secrets: existing?.secrets ?? { allow: [] },
    agent: existing?.agent ?? { timeoutMinutes: DEFAULT_AGENT_TIMEOUT_MINUTES },
  };
  if (config.backend === "opencode") await noteOpencodeModel(ctx);
  const interview = await interviewFor(ctx, config, options);
  if (interview === undefined) return;
  await writeConfig(ctx.cwd, config);
  await writeInterview(ctx.cwd, interview);
  await ensureGitignore(ctx.cwd);
  ctx.prompter.outro(t("init.done", { command: NEXT_COMMAND }));
}

async function chooseLang(ctx: CommandContext, existing: Config | undefined): Promise<Lang> {
  if (ctx.flags.lang) return ctx.flags.lang;
  const initial = existing?.lang ?? getLang();
  if (ctx.flags.yes) return initial;
  const choices: Choice<Lang>[] = [
    { value: "en", label: "English" },
    { value: "es", label: "Español" },
  ];
  return ctx.prompter.select(t("init.lang"), choices, initial);
}

async function chooseMode(ctx: CommandContext, detected: Mode): Promise<Mode> {
  if (ctx.flags.yes) return detected;
  const choices = MODES.map((mode) => ({
    value: mode,
    label: t(`mode.${mode}`),
    hint: mode === detected ? t("init.detected") : undefined,
  }));
  return ctx.prompter.select(t("init.mode"), choices, detected);
}

async function chooseBackend(
  ctx: CommandContext,
  installed: AgentName[],
  existing: Config | undefined,
): Promise<BackendName> {
  if (ctx.flags.backend) return ctx.flags.backend;
  const initial = existing?.backend ?? pickDefaultBackend(installed, ctx.env);
  if (ctx.flags.yes) return initial;
  const backend = await ctx.prompter.select(
    t("init.backend"),
    backendChoices(ctx, installed),
    initial,
  );
  if (isMissingAgent(backend, installed)) {
    ctx.prompter.warn(t("init.backendMissing", { command: backend }));
  }
  return backend;
}

function backendChoices(ctx: CommandContext, installed: AgentName[]): Choice<BackendName>[] {
  const agents = [...installed, ...AGENT_BACKENDS.filter((name) => !installed.includes(name))];
  return [
    ...agents.map((name) => ({
      value: name,
      label: BACKEND_LABELS[name],
      hint: t(installed.includes(name) ? "backend.hint.installed" : "backend.hint.missing"),
    })),
    {
      value: "api",
      label: "API",
      hint: t(hasApiCredentials(ctx.env) ? "backend.hint.apiReady" : "backend.hint.api"),
    },
    { value: "manual", label: t("backend.label.manual"), hint: t("backend.hint.manual") },
  ];
}

function isMissingAgent(backend: BackendName, installed: AgentName[]): boolean {
  return AGENT_BACKENDS.some((name) => name === backend && !installed.includes(name));
}

async function chooseTargets(
  ctx: CommandContext,
  installed: AgentName[],
  existing: Config | undefined,
): Promise<Target[]> {
  const detected = installed.map((name) => TARGET_FOR[name]);
  const initial = existing?.targets ?? (detected.length > 0 ? detected : ["claude-code"]);
  if (ctx.flags.yes) return initial;
  const choices = TARGETS.map((target) => ({ value: target, label: TARGET_LABELS[target] }));
  return ctx.prompter.multiselect(t("init.targets"), choices, initial);
}

async function interviewFor(
  ctx: CommandContext,
  config: Config,
  options: InitOptions,
): Promise<string | undefined> {
  const current = await readInterview(ctx.cwd);
  if (current && options.brief === undefined && !(await wantsRedo(ctx))) {
    return ctx.flags.dryRun ? finishDryRun(ctx) : current;
  }
  const data = await collectInterview(ctx, config.mode, options.brief);
  const adaptive = !ctx.flags.yes && config.backend !== "manual";
  if (!adaptive && config.backend === "manual" && !ctx.flags.yes) {
    ctx.prompter.info(t("interview.adaptiveManual"));
  }
  if (!adaptive) return ctx.flags.dryRun ? finishDryRun(ctx) : renderInterview(data);
  const digest = await ctx.prompter.spinner(t("digest.reading"), async () => {
    return (await buildDigest(ctx.cwd, { maxChars: config.digest.maxChars })).text;
  });
  const base = {
    cwd: ctx.cwd,
    projectType: config.mode,
    lang: config.lang,
    targets: config.targets,
    digest,
    canExplore: AGENT_BACKENDS.some((name) => name === config.backend),
  };
  if (ctx.flags.dryRun) {
    ctx.print(`${wholePrompt(await interviewPrompt(base, data))}\n`);
    ctx.prompter.outro(t("init.dryRunDone"));
    return undefined;
  }
  const backend = ctx.createBackend(config.backend);
  const result = await runAdaptiveRound({ ...base, backend, prompter: ctx.prompter }, data);
  return renderInterview(result);
}

async function wantsRedo(ctx: CommandContext): Promise<boolean> {
  if (ctx.flags.yes) return false;
  return ctx.prompter.confirm(t("init.redoInterview"), false);
}

function finishDryRun(ctx: CommandContext): undefined {
  ctx.prompter.info(t("init.dryRunNoAi"));
  ctx.prompter.outro(t("init.dryRunDone"));
  return undefined;
}

async function collectInterview(
  ctx: CommandContext,
  mode: Mode,
  briefOption: string | undefined,
): Promise<InterviewData> {
  const interactive = !ctx.flags.yes;
  if (interactive) ctx.prompter.info(t("interview.intro"));
  const brief = await collectBrief(ctx, briefOption);
  const objective = interactive && mode === "brownfield" ? await askObjective(ctx) : undefined;
  const answers = [];
  if (interactive) {
    for (const key of BASE_QUESTIONS) {
      answers.push({ question: t(key), answer: await ctx.prompter.text(t(key)) });
    }
  }
  return { mode, objective, brief: brief.text, answers, followUps: [] };
}

async function collectBrief(ctx: CommandContext, option: string | undefined): Promise<Brief> {
  if (option !== undefined) {
    const brief = await loadBrief(ctx.cwd, option);
    if (brief.files.length === 0) throw new UserError(t("init.briefMissing", { path: option }));
    return brief;
  }
  if (ctx.flags.yes) return { text: "", files: [] };
  const raw = await ctx.prompter.text(t("interview.brief"), t("interview.briefPlaceholder"));
  const brief = await loadBrief(ctx.cwd, raw);
  if (brief.files.length > 0) {
    const paths = brief.files.join(", ");
    ctx.prompter.success(t("interview.briefLoaded", { count: brief.files.length, paths }));
  }
  return brief;
}

async function askObjective(ctx: CommandContext): Promise<string | undefined> {
  const choices = OBJECTIVES.map((value) => ({ value, label: t(OBJECTIVE_LABELS[value]) }));
  const objective = await ctx.prompter.select(t("interview.objective"), choices, "feature");
  return objective === "skip" ? undefined : t(OBJECTIVE_LABELS[objective]);
}
