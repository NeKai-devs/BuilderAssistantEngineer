import type { Progress } from "../backends/types.js";
import { t } from "../i18n/index.js";
import { describeProgress } from "../ui/progress.js";

const FILE_MARKER = /<<<\s*FILE\s*:\s*([^>\n]+?)\s*>>>/gi;
const TAIL = 300;

export type PlanProgress = {
  stream: (chunk: string) => void;
  onProgress: (progress: Progress) => void;
  files: () => number;
};

export function planProgress(backend: string, update: (message: string) => void): PlanProgress {
  const files = new Set<string>();
  let tail = "";
  let current = "";
  let step = "";
  const show = () => {
    if (current) {
      update(t("plan.progressFiles", { backend, count: files.size, file: current }));
    } else if (step) {
      update(t("plan.progressStep", { backend, step }));
    }
  };
  const scan = (text: string) => {
    const joined = tail + text;
    let found = false;
    for (const match of joined.matchAll(FILE_MARKER)) {
      const path = (match[1] ?? "").trim();
      if (!path || files.has(path)) continue;
      files.add(path);
      current = path;
      found = true;
    }
    tail = joined.slice(-TAIL);
    if (found) show();
  };
  return {
    stream: scan,
    onProgress: (progress) => {
      if (progress.type === "text") {
        scan(progress.text);
        return;
      }
      step = describeProgress(progress) ?? step;
      if (!current) show();
    },
    files: () => files.size,
  };
}
