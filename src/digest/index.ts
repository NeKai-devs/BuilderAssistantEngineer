import { basename, resolve } from "node:path";
import { DEFAULT_DIGEST_MAX_CHARS, type Mode } from "../config/schema.js";
import { detectMode } from "../detect/mode.js";
import type { Baseline } from "./baseline.js";
import { detectBaseline } from "./baseline.js";
import { type Block, fitBlocks } from "./budget.js";
import { baseName, isReadable, languageOf } from "./files.js";
import { truncateText } from "./format.js";
import { readGitInfo } from "./git.js";
import {
  detectFrameworks,
  detectPackageManagers,
  findManifestPaths,
  type Manifest,
  toManifest,
} from "./manifests.js";
import { readText, readTexts } from "./read.js";
import { redact } from "./redact.js";
import { type Facts, renderContents, renderHead, renderOmitted } from "./render.js";
import { findConfigs, findDocs, findEntryPoints } from "./select.js";
import { countTodos } from "./todos.js";
import { DEFAULT_TREE_DEPTH } from "./tree.js";
import { type FileEntry, scanFiles } from "./walk.js";

export type { Baseline, BaselineCheck } from "./baseline.js";
export { BASELINE_CHECKS } from "./baseline.js";

export type DigestOptions = { maxChars?: number; treeDepth?: number };
export type Digest = { text: string; mode: Mode; baseline: Baseline; omitted: string[] };

const CONTENT_RESERVE = 3_000;
const MAX_CONTENT_BYTES = 1_000_000;
const TODO_MAX_FILES = 5_000;
const TODO_MAX_BYTES = 256_000;

const CAPS = { manifest: 8_000, entry: 6_000, readme: 12_000, doc: 6_000, config: 3_000 };

const GROUPS = {
  manifests: { group: "Manifest contents", priority: 1 },
  entries: { group: "Entry point contents", priority: 2 },
  docs: { group: "Doc contents", priority: 3 },
  configs: { group: "Config contents", priority: 4 },
};

export async function buildDigest(root: string, options: DigestOptions = {}): Promise<Digest> {
  const maxChars = options.maxChars ?? DEFAULT_DIGEST_MAX_CHARS;
  const facts = await gatherFacts(root, options.treeDepth ?? DEFAULT_TREE_DEPTH);
  const head = truncateText(`${renderHead(facts)}\n\n`, maxChars);
  const blocks = await contentBlocks(root, facts);
  const fitted = fitBlocks(blocks, maxChars - head.length - CONTENT_RESERVE);
  const body = renderContents(fitted.blocks) + renderOmitted(fitted.omitted);
  return {
    text: truncateText(head + body, maxChars),
    mode: facts.mode,
    baseline: facts.baseline,
    omitted: fitted.omitted,
  };
}

async function gatherFacts(root: string, treeDepth: number): Promise<Facts> {
  const scan = await scanFiles(root);
  const paths = scan.files.map((file) => file.path);
  const manifests = await readManifests(root, findManifestPaths(paths));
  const [git, todoTexts] = await Promise.all([
    readGitInfo(root),
    readTexts(root, todoCandidates(scan.files)),
  ]);
  return {
    name: basename(resolve(root)),
    mode: detectMode(paths),
    scan,
    manifests,
    frameworks: detectFrameworks(manifests),
    packageManagers: detectPackageManagers(paths, manifests),
    baseline: detectBaseline(paths, manifests),
    entryPoints: findEntryPoints(paths, manifests),
    docs: findDocs(paths),
    configs: findConfigs(paths),
    git,
    todos: countTodos(todoTexts),
    treeDepth,
  };
}

async function readManifests(root: string, paths: string[]): Promise<Manifest[]> {
  const texts = await readTexts(root, paths);
  return paths
    .map((path) => toManifest(path, texts.get(path) ?? ""))
    .filter((manifest): manifest is Manifest => manifest !== undefined);
}

function todoCandidates(files: FileEntry[]): string[] {
  return files
    .filter((file) => file.size <= TODO_MAX_BYTES && languageOf(file.path) && isReadable(file.path))
    .slice(0, TODO_MAX_FILES)
    .map((file) => file.path);
}

async function contentBlocks(root: string, facts: Facts): Promise<Block[]> {
  const sizes = new Map(facts.scan.files.map((file) => [file.path, file.size]));
  const read = async (path: string, group: typeof GROUPS.docs, cap: number) => {
    if (!isReadable(path) || (sizes.get(path) ?? 0) > MAX_CONTENT_BYTES) return undefined;
    const text = await readText(root, path);
    return text === undefined ? undefined : toBlock(path, text, group, cap);
  };
  const manifests = facts.manifests.map((manifest) =>
    toBlock(manifest.path, manifest.text, GROUPS.manifests, CAPS.manifest),
  );
  const others = await Promise.all([
    ...facts.entryPoints.map((path) => read(path, GROUPS.entries, CAPS.entry)),
    ...facts.docs.map((path) => read(path, GROUPS.docs, docCap(path))),
    ...facts.configs.map((path) => read(path, GROUPS.configs, CAPS.config)),
  ]);
  return [...manifests, ...others.filter((block): block is Block => block !== undefined)];
}

function toBlock(
  path: string,
  text: string,
  group: { group: string; priority: number },
  cap: number,
): Block {
  return { ...group, path, body: truncateText(redact(text).trimEnd(), cap) };
}

function docCap(path: string): number {
  return /^readme/i.test(baseName(path)) ? CAPS.readme : CAPS.doc;
}
