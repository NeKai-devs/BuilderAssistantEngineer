import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEY_LENGTH = 16;

export function stateHome(): string {
  return process.env.BAE_HOME || join(homedir(), ".bae");
}

export function repoState(cwd: string): string {
  return join(stateHome(), repoKey(cwd));
}

export function repoKey(cwd: string): string {
  return createHash("sha256").update(realPath(cwd)).digest("hex").slice(0, KEY_LENGTH);
}

export function displayPath(path: string): string {
  const home = homedir();
  const shown = path.startsWith(home) ? `~${path.slice(home.length)}` : path;
  return shown.split("\\").join("/");
}

function realPath(cwd: string): string {
  try {
    return realpathSync.native(cwd);
  } catch {
    return cwd;
  }
}
