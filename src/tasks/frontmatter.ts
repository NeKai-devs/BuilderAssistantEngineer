import { parse } from "yaml";
import { asRecord } from "../core/json.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const LINE = /^([A-Za-z_][\w-]*)[ \t]*:[ \t]*(.*)$/;

export type Frontmatter = { data: Record<string, unknown>; body: string };

export function splitFrontmatter(text: string): Frontmatter | undefined {
  const match = FRONTMATTER.exec(text);
  if (!match) return undefined;
  return { data: parseFields(match[1] ?? ""), body: text.slice(match[0].length) };
}

export function setFrontmatterFields(text: string, fields: Record<string, string>): string {
  const match = FRONTMATTER.exec(text);
  if (!match) return text;
  let lines = (match[1] ?? "").split(/\r?\n/);
  for (const [key, value] of Object.entries(fields)) {
    const first = lines.findIndex((line) => LINE.exec(line)?.[1] === key);
    lines =
      first === -1
        ? [...lines, `${key}: ${value}`]
        : lines.flatMap((line, index) => {
            if (index === first) return [`${key}: ${value}`];
            return LINE.exec(line)?.[1] === key ? [] : [line];
          });
  }
  return `---\n${lines.join("\n")}\n---\n${text.slice(match[0].length)}`;
}

function parseFields(raw: string): Record<string, unknown> {
  try {
    return asRecord(parse(raw));
  } catch {
    return parseLoose(raw);
  }
}

function parseLoose(raw: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match?.[1]) fields[match[1]] = looseValue((match[2] ?? "").trim());
  }
  return fields;
}

function looseValue(value: string): unknown {
  const list = /^\[(.*)\]$/.exec(value);
  if (list) {
    return (list[1] ?? "")
      .split(",")
      .map((item) => unquote(item.trim()))
      .filter(Boolean);
  }
  return unquote(value);
}

function unquote(value: string): string {
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}
