import { readFile } from "node:fs/promises";
import { join } from "node:path";

const BATCH_SIZE = 64;
const BINARY_SNIFF_BYTES = 8_000;

export async function readText(root: string, path: string): Promise<string | undefined> {
  try {
    const buffer = await readFile(join(root, ...path.split("/")));
    if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return undefined;
    return buffer.toString("utf8");
  } catch {
    return undefined;
  }
}

export async function readTexts(root: string, paths: string[]): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  for (let start = 0; start < paths.length; start += BATCH_SIZE) {
    const batch = paths.slice(start, start + BATCH_SIZE);
    const results = await Promise.all(batch.map((path) => readText(root, path)));
    batch.forEach((path, index) => {
      const text = results[index];
      if (text !== undefined) texts.set(path, text);
    });
  }
  return texts;
}
