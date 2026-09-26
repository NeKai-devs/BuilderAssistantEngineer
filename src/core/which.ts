import { stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

export type Env = Record<string, string | undefined>;

export async function findExecutable(
  name: string,
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (isAbsolute(name) || /[\\/]/.test(name)) return (await isFile(name)) ? name : undefined;
  const dirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  const extensions =
    platform === "win32" ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")] : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`);
      if (await isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
