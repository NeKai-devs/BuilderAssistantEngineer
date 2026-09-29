import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { appendFile, chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const KEY_LENGTH = 16;
const PRIVATE_DIR = 0o700;
const PRIVATE_FILE = 0o600;

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

export async function writeState(path: string, text: string): Promise<void> {
  await privateDir(dirname(path));
  await writeFile(path, text, { encoding: "utf8", mode: PRIVATE_FILE });
  await chmod(path, PRIVATE_FILE).catch(() => {});
}

export async function appendState(path: string, text: string): Promise<void> {
  await privateDir(dirname(path));
  await appendFile(path, text, { encoding: "utf8", mode: PRIVATE_FILE });
  await chmod(path, PRIVATE_FILE).catch(() => {});
}

async function privateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR });
  await chmod(stateHome(), PRIVATE_DIR).catch(() => {});
}
