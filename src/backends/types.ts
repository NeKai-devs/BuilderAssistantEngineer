import type { Backend as BackendName } from "../config/schema.js";

export type Access = "read" | "edit";

export type RunInfo = { model?: string; costUsd?: number; truncated?: boolean };

export type RunOptions = {
  cwd: string;
  stream?: (chunk: string) => void;
  interactive?: boolean;
  access?: Access;
  onInfo?: (info: RunInfo) => void;
};

export type Backend = {
  name: BackendName;
  run(prompt: string, options: RunOptions): Promise<string>;
};
