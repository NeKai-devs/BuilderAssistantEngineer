import { z } from "zod";
import { LANGS } from "../i18n/index.js";

export const MODES = ["greenfield", "brownfield"] as const;
export const BACKENDS = ["claude", "opencode", "codex", "gemini", "api", "manual"] as const;
export const TARGETS = ["claude-code", "opencode", "codex", "gemini"] as const;
export const COMMAND_KEYS = ["test", "lint", "typecheck", "build"] as const;
export const REGRESSION_MODES = ["full", "task", "off"] as const;
export const DEFAULT_DIGEST_MAX_CHARS = 100_000;
export const DEFAULT_AGENT_TIMEOUT_MINUTES = 45;

const command = z.string().trim().min(1).optional();

export const commandsSchema = z.object({
  test: command,
  lint: command,
  typecheck: command,
  build: command,
});

export const configSchema = z.object({
  version: z.literal(1),
  mode: z.enum(MODES),
  backend: z.enum(BACKENDS),
  targets: z.array(z.enum(TARGETS)).min(1),
  lang: z.enum(LANGS),
  digest: z
    .object({ maxChars: z.number().int().positive() })
    .default({ maxChars: DEFAULT_DIGEST_MAX_CHARS }),
  commands: commandsSchema.default({}),
  gates: z
    .object({ regression: z.enum(REGRESSION_MODES).default("full") })
    .default({ regression: "full" }),
  verify: z.object({ allow: z.array(z.string().trim().min(1)).default([]) }).default({ allow: [] }),
  agent: z
    .object({
      timeoutMinutes: z.number().int().positive().default(DEFAULT_AGENT_TIMEOUT_MINUTES),
    })
    .default({ timeoutMinutes: DEFAULT_AGENT_TIMEOUT_MINUTES }),
});

export type Config = z.infer<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;
export type Commands = z.output<typeof commandsSchema>;
export type CommandKey = (typeof COMMAND_KEYS)[number];
export type RegressionMode = (typeof REGRESSION_MODES)[number];
export type Mode = (typeof MODES)[number];
export type Backend = (typeof BACKENDS)[number];
export type Target = (typeof TARGETS)[number];
