import { sectionText, type Task } from "../tasks/schema.js";

const OUT_MARKER =
  /^\W*(out|fuera|excluded|excluido|not in scope|do not (?:change|touch|edit)|don't (?:change|touch|edit)|no (?:cambiar|tocar|modificar))\b/i;
const CODE_SPAN = /`([^`\n]+)`/g;
const LIST_PATH =
  /^\s*[-*+]\s+([\w@.[\]()*?/-]+\/[\w@.[\]()*?/-]*|[\w@-]+\.[A-Za-z]\w*)(?=\s|$|[,;:])/;
const NEW_MARK = /\s*\((?:new|nuevo|nueva)\)$/i;
const REDUCTION_MARK = /\s*\((?:delete|deleted|remove|removed|remove tests|borrar|eliminar)\)$/i;

export function scopePaths(task: Task): string[] {
  const scope = sectionText(task.body, "scope") ?? "";
  const lines = scope.split(/\r?\n/);
  const out = lines.findIndex((line) => OUT_MARKER.test(line.replace(/[`*_]/g, "")));
  const inScope = out === -1 ? lines : lines.slice(0, out);
  const paths = inScope.flatMap((line) => [
    ...Array.from(line.matchAll(CODE_SPAN), (match) => match[1] ?? ""),
    LIST_PATH.exec(line)?.[1] ?? "",
  ]);
  return [...new Set(paths.map(normalize).filter((path): path is string => path !== undefined))];
}

export function reductionPaths(task: Task): string[] {
  const scope = sectionText(task.body, "scope") ?? "";
  return [
    ...scope.matchAll(
      /`([^`\n]+)`\s*\((?:delete|deleted|remove|removed|remove tests|borrar|eliminar)\)|`([^`\n]+?)\s*\((?:delete|deleted|remove|removed|remove tests|borrar|eliminar)\)`/gi,
    ),
  ]
    .map((match) => normalize(match[1] ?? match[2] ?? ""))
    .filter((path): path is string => path !== undefined);
}

export function inScope(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (/[*?]/.test(pattern)) return globToRegExp(pattern).test(file);
    const dir = pattern.endsWith("/") ? pattern : `${pattern}/`;
    return file === pattern.replace(/\/$/, "") || file.startsWith(dir);
  });
}

function normalize(raw: string): string | undefined {
  const path = raw.trim().replace(NEW_MARK, "").replace(REDUCTION_MARK, "").replace(/^\.\//, "");
  if (path === "" || /\s|:\/\//.test(path)) return undefined;
  if (/[*?]/.test(path) && globToRegExp(path).test("a") && globToRegExp(path).test("x/y/z.q")) {
    return undefined;
  }
  return path.includes("/") || /\.[A-Za-z]\w*$/.test(path) ? path : undefined;
}

function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .split("**/")
    .map((part) =>
      part
        .split("**")
        .map((piece) =>
          piece
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, "[^/]*")
            .replace(/\?/g, "[^/]"),
        )
        .join(".*"),
    )
    .join("(?:.*/)?");
  return new RegExp(`^${source}$`);
}
