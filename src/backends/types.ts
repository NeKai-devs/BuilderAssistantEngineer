import type { Backend as BackendName } from "../config/schema.js";

export type Access = "read" | "edit";

export type RunInfo = { model?: string; costUsd?: number; truncated?: boolean; denied?: string[] };

export type Progress =
  | { type: "thinking" }
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; detail: string };

export type RunOptions = {
  cwd: string;
  stream?: (chunk: string) => void;
  interactive?: boolean;
  access?: Access;
  timeoutMs?: number;
  allow?: string[];
  onInfo?: (info: RunInfo) => void;
  onProgress?: (progress: Progress) => void;
};

export type Backend = {
  name: BackendName;
  available?(): Promise<boolean>;
  run(prompt: string, options: RunOptions): Promise<string>;
};
