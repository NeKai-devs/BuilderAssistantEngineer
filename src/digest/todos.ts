export type TodoCount = { total: number; byTag: Record<string, number>; files: [string, number][] };

const TAG = /\b(TODO|FIXME|HACK|XXX)\b/g;
const TOP_FILES = 10;

export function countTodos(texts: Map<string, string>): TodoCount {
  const byTag: Record<string, number> = {};
  const files: [string, number][] = [];
  for (const [path, text] of texts) {
    const tags = Array.from(text.matchAll(TAG), (match) => match[1] ?? "");
    for (const tag of tags) byTag[tag] = (byTag[tag] ?? 0) + 1;
    if (tags.length > 0) files.push([path, tags.length]);
  }
  files.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const total = files.reduce((sum, [, count]) => sum + count, 0);
  return { total, byTag, files: files.slice(0, TOP_FILES) };
}
