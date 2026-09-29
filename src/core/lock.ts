import { rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { t } from "../i18n/index.js";
import { UserError } from "./errors.js";
import { repoState } from "./state.js";

const LOCK_FILE = "lock.json";

export async function withLock<T>(
  cwd: string,
  command: string,
  work: () => Promise<T>,
): Promise<T> {
  const path = join(repoState(cwd), LOCK_FILE);
  await acquire(path, command);
  const release = () => rmSync(path, { force: true });
  process.on("exit", release);
  try {
    return await work();
  } finally {
    process.removeListener("exit", release);
    await rm(path, { force: true });
  }
}

async function acquire(path: string, command: string, retried = false): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  const record = JSON.stringify({ pid: process.pid, command, startedAt: new Date().toISOString() });
  try {
    await writeFile(path, record, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const held = await holder(path);
    if (held && alive(held.pid)) {
      throw new UserError(t("lock.busy", { command: held.command, pid: held.pid }));
    }
    if (retried) throw error;
    await rm(path, { force: true });
    await acquire(path, command, true);
  }
}

async function holder(path: string): Promise<{ pid: number; command: string } | undefined> {
  try {
    const data = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown; command?: unknown };
    return typeof data.pid === "number"
      ? { pid: data.pid, command: String(data.command ?? "bae") }
      : undefined;
  } catch {
    return undefined;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}
