import { join } from "node:path";

export const BAE_DIR = ".bae";

export function baePaths(cwd: string) {
  const dir = join(cwd, BAE_DIR);
  return {
    dir,
    config: join(dir, "config.json"),
    interview: join(dir, "interview.md"),
    prompts: join(dir, "prompts"),
    runs: join(dir, "runs"),
    tmp: join(dir, "tmp"),
    ignore: join(cwd, ".baeignore"),
  };
}
