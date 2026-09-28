import { describe, expect, it } from "vitest";
import { buildDigest } from "../../src/digest/index.js";
import { copyFixture, tempDir, writeFiles } from "../helpers.js";

const fakeToken = ["gh", "p_", "z".repeat(36)].join("");

describe("buildDigest", () => {
  it("describes a node project with baseline, stack and contents", async () => {
    const root = await copyFixture("node-app");
    await writeFiles(root, {
      ".env": `GITHUB_TOKEN=${fakeToken}\n`,
      "src/config.ts": `export const token = "${fakeToken}";\n`,
      "dist/index.js": "compiled",
      "node_modules/express/index.js": "vendor",
      "assets/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
    });
    const digest = await buildDigest(root);
    const { text } = digest;

    expect(digest.mode).toBe("brownfield");
    expect(digest.baseline.tests).toContain("vitest (package.json)");
    expect(digest.baseline.lint).toEqual(["eslint (package.json)", "eslint.config.js"]);
    expect(digest.baseline.formatter).toEqual([]);
    expect(digest.baseline.typecheck).toEqual(["typescript (package.json)", "tsconfig.json"]);
    expect(digest.baseline.ci).toEqual([".github/workflows/ci.yml"]);

    expect(text).toContain("- formatter: absent");
    expect(text).toContain("- Frameworks: Express");
    expect(text).toContain("- Package managers: npm");
    expect(text).toMatch(/## Entry points\n\n- src\/index\.ts\n- src\/cli\.ts/);
    expect(text).toContain("### README.md");
    expect(text).toContain("### docs/architecture.md");
    expect(text).not.toContain("Should not appear as doc content");
    expect(text).toContain("- Total: 3 (TODO 2, FIXME 1)");
    expect(text).toContain("## Git\n\nNot a git repository.");

    expect(text).not.toContain(fakeToken);
    expect(text).not.toMatch(/^\s*dist\//m);
    expect(text).not.toContain("logo.png\n```");
    expect(text).not.toContain("node_modules");
    expect(text).not.toContain("### package-lock.json");
    expect(text).not.toContain("### .env");
  });

  it("stays within the character budget and lists what it left out", async () => {
    const root = await copyFixture("node-app");
    await writeFiles(root, { "docs/huge.md": "word ".repeat(20_000) });
    const digest = await buildDigest(root, { maxChars: 6_000 });
    expect(digest.text.length).toBeLessThanOrEqual(6_000);
    expect(digest.text).toContain("### package.json");
    expect(digest.omitted.length).toBeGreaterThan(0);
    expect(digest.text).toContain("## Omitted for budget");
  });

  it("describes python and go projects", async () => {
    const python = await buildDigest(await copyFixture("python-app"));
    expect(python.text).toContain("- Frameworks: FastAPI");
    expect(python.baseline.tests).toEqual([
      "pytest (pyproject.toml)",
      "1 test file, e.g. tests/test_main.py",
    ]);
    expect(python.baseline.lint).toEqual(["ruff (pyproject.toml)", "[tool.ruff] (pyproject.toml)"]);
    expect(python.baseline.ci).toEqual([]);
    expect(python.text).toContain("- app/main.py");

    const go = await buildDigest(await copyFixture("go-service"));
    expect(go.text).toContain("- Frameworks: Gin");
    expect(go.baseline.typecheck).toEqual(["Go compiler"]);
    expect(go.text).toContain("- main.go");
  });

  it("never includes the values of a tracked .env file", async () => {
    const digest = await buildDigest(await copyFixture("with-secrets"));
    expect(digest.text).toContain(".env.example");
    expect(digest.text).not.toContain("fixture-token-not-a-real-secret");
    expect(digest.text).not.toContain("fixture-password-not-real");
  });

  it("marks an empty folder as greenfield with every baseline item absent", async () => {
    const digest = await buildDigest(await tempDir());
    expect(digest.mode).toBe("greenfield");
    expect(Object.values(digest.baseline).every((evidence) => evidence.length === 0)).toBe(true);
    expect(digest.text).toContain("Empty.");
  });
});
