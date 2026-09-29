import { isAbsolute, relative } from "node:path";
import { asRecord, parseObject } from "../core/json.js";
import type { Progress } from "./types.js";

const DETAIL_CHARS = 100;
const PATH_TOOLS = new Set(["Read", "Edit", "MultiEdit", "Write", "NotebookEdit"]);

export function claudeProgress(
  cwd: string,
  emit: (progress: Progress) => void,
): (chunk: string) => void {
  let pending = "";
  return (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const event = line.trim().startsWith("{") ? parseObject(line.trim()) : undefined;
      if (event) for (const progress of progressOf(event, cwd)) emit(progress);
    }
  };
}

function progressOf(event: Record<string, unknown>, cwd: string): Progress[] {
  if (event.type === "stream_event") {
    const inner = asRecord(event.event);
    if (inner.type === "content_block_start" && asRecord(inner.content_block).type === "thinking") {
      return [{ type: "thinking" }];
    }
    const delta = asRecord(inner.delta);
    if (inner.type === "content_block_delta" && delta.type === "text_delta") {
      return typeof delta.text === "string" ? [{ type: "text", text: delta.text }] : [];
    }
    return [];
  }
  if (event.type !== "assistant") return [];
  const content = asRecord(event.message).content;
  return (Array.isArray(content) ? content : []).flatMap((value) => {
    const block = asRecord(value);
    if (block.type !== "tool_use" || typeof block.name !== "string") return [];
    return [
      { type: "tool", tool: block.name, detail: detailOf(block.name, asRecord(block.input), cwd) },
    ];
  });
}

function detailOf(tool: string, input: Record<string, unknown>, cwd: string): string {
  const raw = PATH_TOOLS.has(tool)
    ? shortPath(String(input.file_path ?? input.notebook_path ?? ""), cwd)
    : String(input.command ?? input.pattern ?? input.url ?? input.description ?? "");
  const line = raw.replace(/\s+/g, " ").trim();
  return line.length > DETAIL_CHARS ? `${line.slice(0, DETAIL_CHARS - 1)}…` : line;
}

function shortPath(path: string, cwd: string): string {
  if (!isAbsolute(path)) return path;
  const inside = relative(cwd, path);
  return inside.startsWith("..") ? path : inside.split("\\").join("/");
}
