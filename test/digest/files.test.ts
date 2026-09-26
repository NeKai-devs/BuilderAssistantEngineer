import { describe, expect, it } from "vitest";
import {
  byPath,
  isBinaryPath,
  isLockfile,
  isReadable,
  isSecretPath,
  languageOf,
} from "../../src/digest/files.js";

describe("file classification", () => {
  it("treats env files and keys as secrets, but not examples", () => {
    for (const path of [
      ".env",
      "app/.env.local",
      "certs/server.pem",
      "id_rsa",
      "infra/prod.tfvars",
    ]) {
      expect(isSecretPath(path)).toBe(true);
    }
    for (const path of [".env.example", "config/.env.sample", "src/env.ts", "id_rsa.pub"]) {
      expect(isSecretPath(path)).toBe(false);
    }
  });

  it("detects lockfiles and binaries", () => {
    expect(isLockfile("packages/web/pnpm-lock.yaml")).toBe(true);
    expect(isLockfile("package.json")).toBe(false);
    expect(isBinaryPath("public/logo.PNG")).toBe(true);
    expect(isReadable("src/index.ts")).toBe(true);
    expect(isReadable("yarn.lock")).toBe(false);
  });

  it("maps extensions to languages", () => {
    expect(languageOf("src/app.tsx")).toBe("TypeScript");
    expect(languageOf("main.go")).toBe("Go");
    expect(languageOf("README.md")).toBeUndefined();
  });

  it("orders paths by depth, then name", () => {
    expect(["b/a.ts", "z.ts", "a/b/c.ts", "a.ts"].sort(byPath)).toEqual([
      "a.ts",
      "z.ts",
      "b/a.ts",
      "a/b/c.ts",
    ]);
  });
});
