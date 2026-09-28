import { lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function isSymlink(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined))?.isSymbolicLink() ?? false;
}

export async function looksBinary(path: string): Promise<boolean> {
  const handle = await open(path, "r").catch(() => undefined);
  if (!handle) return false;
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}
