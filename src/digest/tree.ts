type TreeNode = { dirs: Map<string, TreeNode>; files: string[]; count: number };

export const DEFAULT_TREE_DEPTH = 3;
export const TREE_MAX_LINES = 300;
export const TREE_ENTRIES_PER_DIR = 30;

export function renderTree(paths: string[], depth = DEFAULT_TREE_DEPTH): string {
  const lines: string[] = [];
  renderNode(buildTree(paths), 0, depth, lines);
  if (lines.length <= TREE_MAX_LINES) return lines.join("\n");
  const hidden = lines.length - TREE_MAX_LINES;
  return [...lines.slice(0, TREE_MAX_LINES), `… ${hidden} more lines`].join("\n");
}

function buildTree(paths: string[]): TreeNode {
  const root = newNode();
  for (const path of paths) {
    const parts = path.split("/");
    const file = parts.pop() ?? path;
    let node = root;
    node.count++;
    for (const part of parts) {
      const child = node.dirs.get(part) ?? newNode();
      node.dirs.set(part, child);
      node = child;
      node.count++;
    }
    node.files.push(file);
  }
  return root;
}

function renderNode(node: TreeNode, level: number, depth: number, lines: string[]): void {
  const indent = "  ".repeat(level);
  const dirs = [...node.dirs.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const files = [...node.files].sort();
  let shown = 0;
  for (const [name, child] of dirs) {
    if (shown++ >= TREE_ENTRIES_PER_DIR) break;
    if (level + 1 >= depth) {
      lines.push(`${indent}${name}/ (${child.count} files)`);
      continue;
    }
    lines.push(`${indent}${name}/`);
    renderNode(child, level + 1, depth, lines);
  }
  for (const file of files) {
    if (shown++ >= TREE_ENTRIES_PER_DIR) break;
    lines.push(`${indent}${file}`);
  }
  const hidden = dirs.length + files.length - TREE_ENTRIES_PER_DIR;
  if (hidden > 0) lines.push(`${indent}… ${hidden} more`);
}

function newNode(): TreeNode {
  return { dirs: new Map(), files: [], count: 0 };
}
