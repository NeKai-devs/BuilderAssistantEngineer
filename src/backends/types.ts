import type { Backend as BackendName } from "../config/schema.js";

export type Access = "read" | "edit";

export type RunOptions = {
  cwd: string;
  stream?: (chunk: string) => void;
  interactive?: boolean;
  access?: Access;
};

export type Backend = {
  name: BackendName;
  run(prompt: string, options: RunOptions): Promise<string>;
};
