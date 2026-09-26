import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { redact } from "../digest/redact.js";

export type Brief = { text: string; files: string[] };

const MAX_FILE_CHARS = 50_000;

export async function loadBrief(cwd: string, raw: string): Promise<Brief> {
  const tokens = raw
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return { text: "", files: [] };
  const contents = await Promise.all(tokens.map((token) => readIfFile(resolve(cwd, token))));
  if (contents.some((content) => content === undefined))
    return { text: redact(raw.trim()), files: [] };
  const sections = tokens.map((token, index) => `### ${token}\n\n${contents[index] ?? ""}`);
  return { text: redact(sections.join("\n\n")), files: tokens };
}

async function readIfFile(path: string): Promise<string | undefined> {
  try {
    if (!(await stat(path)).isFile()) return undefined;
    return (await readFile(path, "utf8")).slice(0, MAX_FILE_CHARS).trim();
  } catch {
    return undefined;
  }
}
