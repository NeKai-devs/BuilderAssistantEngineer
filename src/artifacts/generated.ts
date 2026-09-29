import { stringify } from "yaml";
import { CLI } from "../commands/shared.js";
import { type MessageKey, t } from "../i18n/index.js";
import type { PlanFile } from "../plan/parser.js";
import { splitFrontmatter } from "../tasks/frontmatter.js";

const CLAUDE_AGENT = /^\.claude\/agents\/([^/]+\.md)$/;
const COMMAND_PATH = /^\.(claude\/commands|opencode\/command)\//;
const COMMANDS: Record<string, MessageKey> = {
  next: "template.next",
  status: "template.status",
  review: "template.review",
};
const EDITING = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

export function withGeneratedFiles(files: PlanFile[]): PlanFile[] {
  const written = files.filter((file) => !COMMAND_PATH.test(file.path));
  const paths = new Set(written.map((file) => file.path));
  const converted = written.flatMap((file) => {
    const name = CLAUDE_AGENT.exec(file.path)?.[1];
    const path = `.opencode/agent/${name}`;
    return name && !paths.has(path) ? [{ path, content: opencodeAgent(file.content) }] : [];
  });
  const commands = Object.entries(COMMANDS).flatMap(([name, key]) => {
    const content = `${t(key, { cli: CLI })}\n`;
    return [
      { path: `.claude/commands/${name}.md`, content },
      { path: `.opencode/command/${name}.md`, content },
    ];
  });
  return [...written, ...converted, ...commands];
}

export function opencodeAgent(claude: string): string {
  const parsed = splitFrontmatter(claude);
  const data = parsed?.data ?? {};
  const tools = toolList(data.tools);
  const limits = tools
    ? {
        ...(EDITING.some((tool) => tools.includes(tool)) ? {} : { write: false, edit: false }),
        ...(tools.includes("Bash") ? {} : { bash: false }),
      }
    : {};
  const front = {
    description: String(data.description ?? ""),
    mode: "subagent",
    ...(Object.keys(limits).length > 0 ? { tools: limits } : {}),
  };
  return `---\n${stringify(front, { lineWidth: 0 }).trimEnd()}\n---\n${(parsed?.body ?? claude).replace(/^\n+/, "")}`;
}

function toolList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((item) => String(item).trim());
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.split(",").map((item) => item.trim());
}
