import { posix } from "node:path";
import { asRecord } from "../core/json.js";
import { isCiPath } from "./baseline.js";
import { baseName, byPath } from "./files.js";
import { ecosystemOf, type Manifest } from "./manifests.js";

export const MAX_ENTRY_POINTS = 8;
export const MAX_DOCS = 10;
export const MAX_CONFIGS = 20;

const ENTRY_PATTERNS = [
  /^(src\/)?(index|main|app|server|cli)\.(ts|tsx|mts|js|jsx|mjs|cjs)$/,
  /^(src\/)?App\.(tsx|jsx|vue|svelte)$/,
  /^(src\/)?app\/(page|layout)\.(tsx|jsx)$/,
  /^pages\/(index|_app)\.(tsx|jsx|js)$/,
  /^(app\/|src\/[^/]+\/)?(main|app|manage|wsgi|asgi|__main__)\.py$/,
  /^src\/(main|lib)\.rs$/,
  /^(cmd\/[^/]+\/)?main\.go$/,
  /^Program\.cs$/,
  /^src\/main\/java\/.+Application\.java$/,
  /^public\/index\.php$/,
  /^artisan$/,
  /^config\.ru$/,
  /^lib\/main\.dart$/,
  /^Sources\/[^/]+\/main\.swift$/,
];

const ROOT_DOCS = [
  /^readme(\.[a-z]+)?$/i,
  /^agents\.md$/i,
  /^claude\.md$/i,
  /^gemini\.md$/i,
  /^contributing(\.[a-z]+)?$/i,
  /^architecture(\.[a-z]+)?$/i,
];

const CONFIG_NAMES = [
  /^tsconfig(\..+)?\.json$/,
  /^jsconfig\.json$/,
  /^Dockerfile(\..+)?$/,
  /^(docker-)?compose(\..+)?\.ya?ml$/,
  /^eslint\.config\.[cm]?[jt]s$/,
  /^\.eslintrc(\..+)?$/,
  /^\.prettierrc(\..+)?$/,
  /^prettier\.config\.[cm]?[jt]s$/,
  /^biome\.jsonc?$/,
  /^\.editorconfig$/,
  /^(vite|vitest|jest|playwright|webpack|rollup|next|nuxt|svelte|astro|tailwind|postcss|babel)\.config\.[cm]?[jt]s$/,
  /^Makefile$/,
  /^justfile$/i,
  /^Taskfile\.ya?ml$/,
  /^\.nvmrc$/,
  /^\.node-version$/,
  /^\.python-version$/,
  /^\.tool-versions$/,
  /^tox\.ini$/,
  /^\.?ruff\.toml$/,
  /^\.?mypy\.ini$/,
  /^pytest\.ini$/,
  /^\.golangci\.ya?ml$/,
  /^\.rubocop\.yml$/,
  /^phpunit\.xml(\.dist)?$/,
  /^Procfile$/,
  /^fly\.toml$/,
  /^vercel\.json$/,
  /^netlify\.toml$/,
  /^turbo\.json$/,
  /^nx\.json$/,
  /^pnpm-workspace\.yaml$/,
  /^\.env\.(example|sample|template)$/,
];

export function findEntryPoints(paths: string[], manifests: Manifest[]): string[] {
  const available = new Set(paths);
  const declared = manifests
    .flatMap(declaredEntries)
    .map((path) => resolveSource(path, available))
    .filter((path): path is string => path !== undefined);
  const conventional = paths.filter((path) => ENTRY_PATTERNS.some((pattern) => pattern.test(path)));
  return [...new Set([...declared, ...conventional])].slice(0, MAX_ENTRY_POINTS);
}

export function findDocs(paths: string[]): string[] {
  const root = ROOT_DOCS.flatMap((pattern) =>
    paths.filter((path) => !path.includes("/") && pattern.test(path)),
  );
  const nested = paths
    .filter((path) => /^docs?\/.+\.(md|mdx|rst|txt)$/i.test(path) && !path.startsWith("docs/plan/"))
    .sort(byPath);
  return [...new Set([...root, ...nested])].slice(0, MAX_DOCS);
}

export function findConfigs(paths: string[]): string[] {
  return paths
    .filter(
      (path) => isCiPath(path) || CONFIG_NAMES.some((pattern) => pattern.test(baseName(path))),
    )
    .filter((path) => ecosystemOf(path) === undefined)
    .sort(byPath)
    .slice(0, MAX_CONFIGS);
}

function declaredEntries(manifest: Manifest): string[] {
  if (baseName(manifest.path) !== "package.json" || !manifest.json) return [];
  const { main, module, bin, exports } = manifest.json;
  const dir = posix.dirname(manifest.path);
  return [main, module, ...binEntries(bin), exportRoot(exports)]
    .filter((value): value is string => typeof value === "string")
    .map((value) => posix.normalize(posix.join(dir, value)));
}

function binEntries(bin: unknown): unknown[] {
  return typeof bin === "string" ? [bin] : Object.values(asRecord(bin));
}

function exportRoot(exports: unknown): unknown {
  if (typeof exports === "string") return exports;
  const root = asRecord(exports)["."] ?? exports;
  if (typeof root === "string") return root;
  const conditions = asRecord(root);
  return conditions.import ?? conditions.default ?? conditions.require;
}

function resolveSource(path: string, available: Set<string>): string | undefined {
  const stem = path.replace(/^(dist|build|lib|out)\//, "src/").replace(/\.(m|c)?js$/, "");
  const candidates = [path, ...[".ts", ".tsx", ".mts", ".js"].map((ext) => `${stem}${ext}`)];
  return candidates.find((candidate) => available.has(candidate));
}
