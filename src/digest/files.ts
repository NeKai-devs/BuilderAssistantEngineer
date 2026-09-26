import { posix } from "node:path";

const BINARY_EXTENSIONS = new Set(
  [
    "png jpg jpeg gif bmp ico icns webp avif tiff psd svgz",
    "pdf doc docx xls xlsx ppt pptx odt",
    "zip gz tgz bz2 xz 7z rar tar jar war ear",
    "exe dll so dylib a o obj lib class pyc pyo wasm bin dat",
    "woff woff2 ttf otf eot",
    "mp3 mp4 m4a wav ogg flac webm mov avi mkv",
    "sqlite sqlite3 db",
  ]
    .join(" ")
    .split(" ")
    .map((extension) => `.${extension}`),
);

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "pdm.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
  "mix.lock",
  "pubspec.lock",
  "Podfile.lock",
  "packages.lock.json",
  "flake.lock",
]);

const SECRET_NAMES = new Set([
  ".envrc",
  ".netrc",
  ".pgpass",
  "credentials",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);

const SECRET_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
  ".tfstate",
  ".tfvars",
]);

const LANGUAGES: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".scala": "Scala",
  ".cs": "C#",
  ".fs": "F#",
  ".php": "PHP",
  ".rb": "Ruby",
  ".swift": "Swift",
  ".m": "Objective-C",
  ".c": "C",
  ".h": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".hpp": "C++",
  ".dart": "Dart",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".erl": "Erlang",
  ".hs": "Haskell",
  ".lua": "Lua",
  ".r": "R",
  ".jl": "Julia",
  ".zig": "Zig",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".astro": "Astro",
  ".html": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".sass": "SCSS",
  ".less": "Less",
  ".sql": "SQL",
  ".sh": "Shell",
  ".bash": "Shell",
  ".ps1": "PowerShell",
  ".tf": "Terraform",
  ".proto": "Protocol Buffers",
  ".graphql": "GraphQL",
};

export function extensionOf(path: string): string {
  return posix.extname(path).toLowerCase();
}

export function baseName(path: string): string {
  return posix.basename(path);
}

export function depthOf(path: string): number {
  return path.split("/").length - 1;
}

export function isBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.has(extensionOf(path));
}

export function isLockfile(path: string): boolean {
  return LOCKFILES.has(baseName(path));
}

export function isSecretPath(path: string): boolean {
  const name = baseName(path).toLowerCase();
  if (/^\.env(\..+)?$/.test(name)) return !/\.(example|sample|template|dist)$/.test(name);
  return SECRET_NAMES.has(name) || SECRET_EXTENSIONS.has(extensionOf(name));
}

export function isReadable(path: string): boolean {
  return !isBinaryPath(path) && !isLockfile(path) && !isSecretPath(path);
}

export function languageOf(path: string): string | undefined {
  return LANGUAGES[extensionOf(path)];
}

export function byPath(a: string, b: string): number {
  return depthOf(a) - depthOf(b) || (a < b ? -1 : a > b ? 1 : 0);
}
