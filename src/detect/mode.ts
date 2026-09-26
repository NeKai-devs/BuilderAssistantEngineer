import type { Mode } from "../config/schema.js";
import { languageOf } from "../digest/files.js";
import { ecosystemOf } from "../digest/manifests.js";
import { scanFiles } from "../digest/walk.js";

export function detectMode(paths: string[]): Mode {
  const hasCode = paths.some(
    (path) => ecosystemOf(path) !== undefined || languageOf(path) !== undefined,
  );
  return hasCode ? "brownfield" : "greenfield";
}

export async function detectProjectMode(root: string): Promise<Mode> {
  const { files } = await scanFiles(root);
  return detectMode(files.map((file) => file.path));
}
