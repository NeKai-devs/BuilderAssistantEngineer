import { baseName, byPath, extensionOf } from "./files.js";

export type Ecosystem =
  | "npm"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "php"
  | "ruby"
  | "dotnet"
  | "elixir"
  | "dart"
  | "swift";

export type Manifest = {
  path: string;
  ecosystem: Ecosystem;
  text: string;
  json: Record<string, unknown> | undefined;
  dependencies: Set<string>;
};

export const MAX_MANIFESTS = 20;

const MANIFESTS = new Map<string, Ecosystem>([
  ["package.json", "npm"],
  ["deno.json", "npm"],
  ["deno.jsonc", "npm"],
  ["pyproject.toml", "python"],
  ["setup.py", "python"],
  ["setup.cfg", "python"],
  ["Pipfile", "python"],
  ["go.mod", "go"],
  ["Cargo.toml", "rust"],
  ["pom.xml", "java"],
  ["build.gradle", "java"],
  ["build.gradle.kts", "java"],
  ["composer.json", "php"],
  ["Gemfile", "ruby"],
  ["mix.exs", "elixir"],
  ["pubspec.yaml", "dart"],
  ["Package.swift", "swift"],
]);

const DOTNET_EXTENSIONS = new Set([".csproj", ".fsproj", ".vbproj"]);

const JSON_DEPENDENCY_FIELDS = new Map<string, string[]>([
  ["package.json", ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]],
  ["composer.json", ["require", "require-dev"]],
]);

const LOCKFILE_MANAGERS: [string, string][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["deno.lock", "deno"],
  ["poetry.lock", "poetry"],
  ["uv.lock", "uv"],
  ["Pipfile.lock", "pipenv"],
  ["pdm.lock", "pdm"],
  ["Cargo.lock", "cargo"],
  ["go.sum", "go modules"],
  ["composer.lock", "composer"],
  ["Gemfile.lock", "bundler"],
  ["mix.lock", "mix"],
  ["pubspec.lock", "pub"],
];

const FRAMEWORKS: [string, Ecosystem, string][] = [
  ["Next.js", "npm", "next"],
  ["React", "npm", "react"],
  ["React Native", "npm", "react-native"],
  ["Expo", "npm", "expo"],
  ["Vue", "npm", "vue"],
  ["Nuxt", "npm", "nuxt"],
  ["Svelte", "npm", "svelte"],
  ["SvelteKit", "npm", "@sveltejs/kit"],
  ["Angular", "npm", "@angular/core"],
  ["Astro", "npm", "astro"],
  ["Remix", "npm", "@remix-run/react"],
  ["Vite", "npm", "vite"],
  ["Express", "npm", "express"],
  ["Fastify", "npm", "fastify"],
  ["Hono", "npm", "hono"],
  ["Koa", "npm", "koa"],
  ["NestJS", "npm", "@nestjs/core"],
  ["Electron", "npm", "electron"],
  ["Prisma", "npm", "prisma"],
  ["Drizzle", "npm", "drizzle-orm"],
  ["TypeORM", "npm", "typeorm"],
  ["Mongoose", "npm", "mongoose"],
  ["Django", "python", "django"],
  ["Flask", "python", "flask"],
  ["FastAPI", "python", "fastapi"],
  ["SQLAlchemy", "python", "sqlalchemy"],
  ["Gin", "go", "gin-gonic/gin"],
  ["Echo", "go", "labstack/echo"],
  ["Fiber", "go", "gofiber/fiber"],
  ["Axum", "rust", "axum"],
  ["Actix Web", "rust", "actix-web"],
  ["Rocket", "rust", "rocket"],
  ["Tokio", "rust", "tokio"],
  ["Spring Boot", "java", "spring-boot"],
  ["Laravel", "php", "laravel/framework"],
  ["Symfony", "php", "symfony/framework-bundle"],
  ["Rails", "ruby", "rails"],
  ["ASP.NET Core", "dotnet", "microsoft.aspnetcore"],
  ["Phoenix", "elixir", "phoenix"],
  ["Flutter", "dart", "flutter"],
];

export function ecosystemOf(path: string): Ecosystem | undefined {
  const name = baseName(path);
  if (/^requirements.*\.txt$/.test(name)) return "python";
  if (DOTNET_EXTENSIONS.has(extensionOf(name))) return "dotnet";
  return MANIFESTS.get(name);
}

export function findManifestPaths(paths: string[]): string[] {
  return paths
    .filter((path) => ecosystemOf(path) !== undefined)
    .sort(byPath)
    .slice(0, MAX_MANIFESTS);
}

export function toManifest(path: string, text: string): Manifest | undefined {
  const ecosystem = ecosystemOf(path);
  if (!ecosystem) return undefined;
  const fields = JSON_DEPENDENCY_FIELDS.get(baseName(path));
  const json = fields || path.endsWith(".json") ? parseObject(text) : undefined;
  const dependencies = new Set(
    (fields ?? []).flatMap((field) => Object.keys(asRecord(json?.[field]))),
  );
  return { path, ecosystem, text, json, dependencies };
}

export function findDependency(
  manifests: Manifest[],
  ecosystem: Ecosystem,
  name: string,
): Manifest | undefined {
  return manifests.find((manifest) => manifest.ecosystem === ecosystem && declares(manifest, name));
}

export function detectFrameworks(manifests: Manifest[]): string[] {
  return FRAMEWORKS.filter(([, ecosystem, name]) => findDependency(manifests, ecosystem, name)).map(
    ([label]) => label,
  );
}

export function detectPackageManagers(paths: string[], manifests: Manifest[]): string[] {
  const names = new Set(paths.map(baseName));
  const declared = manifests
    .map((manifest) => manifest.json?.packageManager)
    .filter((value): value is string => typeof value === "string");
  const locked = LOCKFILE_MANAGERS.filter(([file]) => names.has(file)).map(
    ([, manager]) => manager,
  );
  return [...new Set([...declared, ...locked])];
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function declares(manifest: Manifest, name: string): boolean {
  if (JSON_DEPENDENCY_FIELDS.has(baseName(manifest.path))) return manifest.dependencies.has(name);
  const pattern = new RegExp(`(^|[^a-z0-9_.])${escapeRegExp(name.toLowerCase())}`, "m");
  return pattern.test(manifest.text.toLowerCase());
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
