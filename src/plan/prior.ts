import { join } from "node:path";
import { readTextIfExists } from "../core/fs.js";
import { truncateText } from "../digest/format.js";
import type { LoadedTask } from "../tasks/load.js";

const PLAN_DOCS = ["00-overview.md", "01-prd.md", "02-architecture.md", "04-roadmap.md"];
const MAX_DOC_CHARS = 12_000;
const MAX_PRIOR_CHARS = 80_000;

export const PRIOR_PLAN_RULES =
  "Re-emit every pending, in_progress or blocked task you keep, with its id and status unchanged. Pending tasks you leave out are deleted. Done tasks are kept as they are; do not re-emit them.";

export async function buildPriorPlan(cwd: string, tasks: LoadedTask[]): Promise<string> {
  const docs = await Promise.all(
    PLAN_DOCS.map(async (name) => {
      const text = await readTextIfExists(join(cwd, "docs", "plan", name));
      return text ? `### docs/plan/${name}\n\n${truncateText(text.trim(), MAX_DOC_CHARS)}` : "";
    }),
  );
  const open = tasks.filter((task) => task.task?.meta.status !== "done");
  const sections = [
    PRIOR_PLAN_RULES,
    ["## Task status", "", ...tasks.map(statusLine)].join("\n"),
    ["## Plan documents", "", ...docs.filter(Boolean)].join("\n\n"),
    [
      "## Open task files",
      "",
      ...open.map((task) => `### ${task.path}\n\n${task.text.trim()}`),
    ].join("\n\n"),
  ];
  return truncateText(sections.join("\n\n"), MAX_PRIOR_CHARS);
}

function statusLine(task: LoadedTask): string {
  const meta = task.task?.meta;
  if (!meta) return `- ${task.id} [invalid] ${task.path}`;
  const deps = meta.depends_on.length > 0 ? `, depends on ${meta.depends_on.join(", ")}` : "";
  return `- ${meta.id} [${meta.status}] ${meta.title} (phase ${meta.phase}${deps})`;
}
