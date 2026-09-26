import { describe, expect, it } from "vitest";
import {
  detectFrameworks,
  detectPackageManagers,
  ecosystemOf,
  findManifestPaths,
  type Manifest,
  toManifest,
} from "../../src/digest/manifests.js";

function manifest(path: string, text: string): Manifest {
  const result = toManifest(path, text);
  if (!result) throw new Error(`not a manifest: ${path}`);
  return result;
}

describe("manifests", () => {
  it("recognizes manifests across ecosystems", () => {
    expect(ecosystemOf("requirements-dev.txt")).toBe("python");
    expect(ecosystemOf("src/Api/Api.csproj")).toBe("dotnet");
    expect(ecosystemOf("constructor")).toBeUndefined();
    expect(findManifestPaths(["web/package.json", "README.md", "package.json", "go.mod"])).toEqual([
      "go.mod",
      "package.json",
      "web/package.json",
    ]);
  });

  it("reads JSON dependencies exactly and text manifests by name", () => {
    const pkg = manifest(
      "package.json",
      JSON.stringify({ dependencies: { next: "15" }, devDependencies: { "react-dom": "19" } }),
    );
    const py = manifest("pyproject.toml", 'dependencies = ["Django>=5", "celery"]');
    const go = manifest("go.mod", "require github.com/gin-gonic/gin v1.10.0");
    expect(detectFrameworks([pkg, py, go])).toEqual(["Next.js", "Django", "Gin"]);
  });

  it("does not match frameworks from another ecosystem", () => {
    const py = manifest("pyproject.toml", 'description = "the next react-like thing"');
    expect(detectFrameworks([py])).toEqual([]);
  });

  it("survives invalid JSON", () => {
    expect(manifest("package.json", "{ broken").dependencies.size).toBe(0);
  });

  it("detects package managers from lockfiles and the packageManager field", () => {
    const pkg = manifest("package.json", JSON.stringify({ packageManager: "pnpm@9.1.0" }));
    expect(detectPackageManagers(["pnpm-lock.yaml", "uv.lock"], [pkg])).toEqual([
      "pnpm@9.1.0",
      "pnpm",
      "uv",
    ]);
  });
});
