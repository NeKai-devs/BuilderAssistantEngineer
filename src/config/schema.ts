import { z } from "zod";
import { LANGS } from "../i18n/index.js";

export const MODES = ["greenfield", "brownfield"] as const;
export const BACKENDS = ["claude", "opencode", "codex", "gemini", "api", "manual"] as const;
export const TARGETS = ["claude-code", "opencode", "codex", "gemini"] as const;
export const COMMAND_KEYS = ["test", "lint", "typecheck", "build"] as const;
export const REGRESSION_MODES = ["full", "task", "off"] as const;
export const DEFAULT_DIGEST_MAX_CHARS = 100_000;

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
});

export type Config = z.infer<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;
export type Commands = z.output<typeof commandsSchema>;
export type CommandKey = (typeof COMMAND_KEYS)[number];
export type RegressionMode = (typeof REGRESSION_MODES)[number];
export type Mode = (typeof MODES)[number];
export type Backend = (typeof BACKENDS)[number];
export type Target = (typeof TARGETS)[number];
