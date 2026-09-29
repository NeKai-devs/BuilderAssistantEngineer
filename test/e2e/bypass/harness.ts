import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../../../src/cli.js";
import type { Config } from "../../../src/config/schema.js";
import { writeConfig } from "../../../src/config/store.js";
import { splitFrontmatter } from "../../../src/tasks/frontmatter.js";
import { FAKE_FILES, vitest } from "../../fake-vitest.js";
import { fakePrompter, type Step, scriptedBackend, trusting } from "../../fakes.js";
import { gitCommitAll, runFile, tempDir, writeFiles } from "../../helpers.js";
import { type TaskOptions, taskFile } from "../../plan-sample.js";

export const TASK = "docs/plan/tasks/T-001-first.md";
export const PASS = 'node -e "process.exit(0)"';
export const REVIEW_PASS: Step = () => '{"verdict": "pass", "findings": []}';
export const BREAKS_WITH = (file: string) =>
  `node -e "process.exit(require('fs').existsSync('${file}') ? 1 : 0)"`;
export const fake = (...parts: string[]) => parts.join("");
export const FAIL = 'node -e "process.exit(1)"';
export const LESSON: Step = () =>
  '{"root_cause": "It kept failing.", "rule": "Run the checks before finishing."}';
export const COUNTED = (file: string, total = 10) => vitest(`--total=${total}`, `--worse=${file}`);

export type RepoOptions = {
  task?: TaskOptions;
  files?: Record<string, string>;
  config?: Partial<Config>;
  git?: boolean;
};

export async function bypassRepo(options: RepoOptions = {}): Promise<string> {
  const cwd = await tempDir();
  await writeFiles(cwd, {
    "AGENTS.md": "# Rules\n",
    ".claude/agents/reviewer.md":
      "---\nname: reviewer\ndescription: Strict\n---\nReject shortcuts.",
    [TASK]: taskFile("T-001", { command: PASS, scope: "- `src/feature.ts`", ...options.task }),
    "docs/plan/tasks/T-002-second.md": taskFile("T-002", { dependsOn: ["T-001"] }),
    ...FAKE_FILES,
    ...options.files,
  });
  await writeConfig(cwd, {
    version: 1,
    mode: "greenfield",
    backend: "claude",
    targets: ["claude-code"],
    lang: "en",
    digest: { maxChars: 20_000 },
    commands: {},
    gates: { regression: "full" },
    ...options.config,
  });
  if (options.git !== false) await gitCommitAll(cwd, "plan");
  return cwd;
}

export function agent(cwd: string, files: Record<string, string>, extra?: () => Promise<void>) {
  const step: Step = async () => {
    await writeFiles(cwd, files);
    await extra?.();
    await handoff(cwd);
    return "";
  };
  return step;
}

export async function handoff(cwd: string, note = "Did the work; no traps.") {
  const path = join(cwd, TASK);
  const text = await readFile(path, "utf8");
  if (!text.includes(note)) await writeFile(path, `${text.trimEnd()}\n${note}\n`);
}

export async function next(
  cwd: string,
  args: string[],
  steps: Step[],
  answers: unknown[] = [],
  trusted = true,
) {
  const ui = fakePrompter(answers);
  const ai = scriptedBackend(steps);
  const printed: string[] = [];
  const code = await main(["node", "bae", "next", ...args], cwd, {
    prompter: trusted ? trusting(ui.prompter) : ui.prompter,
    createBackend: () => ai.backend,
    env: {},
    print: (text) => printed.push(text),
  });
  return { code, ui, calls: ai.calls, log: ui.log.join("\n"), printed: printed.join("") };
}

export async function statusOf(cwd: string, path = TASK): Promise<unknown> {
  return splitFrontmatter(await readFile(join(cwd, path), "utf8"))?.data.status;
}

export async function read(cwd: string, path: string): Promise<string> {
  return readFile(join(cwd, ...path.split("/")), "utf8");
}

export async function stops(cwd: string, id = "T-001") {
  return jsonLines(await readFile(runFile(cwd, id, "stops.jsonl"), "utf8").catch(() => ""));
}

export async function attempts(cwd: string, id = "T-001") {
  const text = await readFile(runFile(cwd, id, "attempts.jsonl"), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function jsonLines(text: string) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
