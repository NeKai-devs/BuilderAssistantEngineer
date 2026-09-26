import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main, scanLang } from "../src/cli.js";
import { captureOutput, tempDir } from "./helpers.js";

const argv = (...args: string[]) => ["node", "bae", ...args];

async function run(cwd: string, ...args: string[]) {
  const output = captureOutput();
  const code = await main(argv(...args), cwd);
  return { code, out: output.out(), err: output.err() };
}

describe("cli", () => {
  it("prints the package version", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    const result = await run(await tempDir(), "--version");
    expect(result).toMatchObject({ code: 0, out: `${pkg.version}\n` });
  });

  it("lists every v1 command in the help", async () => {
    const { code, out } = await run(await tempDir(), "--help");
    expect(code).toBe(0);
    for (const command of ["init", "plan", "next", "status", "replan", "review"]) {
      expect(out).toContain(`${command} `);
    }
    for (const flag of ["--backend", "--lang", "--dry-run", "--yes"]) expect(out).toContain(flag);
  });

  it("localizes the help with --lang", async () => {
    const { out } = await run(await tempDir(), "--lang", "es", "--help");
    expect(out).toContain("muestra fases, tareas y progreso");
  });

  it("takes the language from the config when no flag is given", async () => {
    const cwd = await tempDir();
    await mkdir(join(cwd, ".bae"), { recursive: true });
    const config = {
      version: 1,
      mode: "greenfield",
      backend: "manual",
      targets: ["codex"],
      lang: "es",
    };
    await writeFile(join(cwd, ".bae", "config.json"), JSON.stringify(config));
    const { out } = await run(cwd, "--help");
    expect(out).toContain("muestra fases, tareas y progreso");
  });

  it("accepts global flags after the subcommand", async () => {
    const { code, err } = await run(await tempDir(), "status", "--lang", "es", "--yes");
    expect(code).toBe(1);
    expect(err).toContain("`status` aún no está implementado.");
  });

  it("rejects an unknown backend", async () => {
    const { code, err } = await run(await tempDir(), "--backend", "gpt", "status");
    expect(code).toBe(1);
    expect(err).toContain("gpt");
  });
});

describe("scanLang", () => {
  it("reads both flag forms and ignores unsupported values", () => {
    expect(scanLang(argv("--lang", "es"))).toBe("es");
    expect(scanLang(argv("plan", "--lang=es"))).toBe("es");
    expect(scanLang(argv("--lang", "fr"))).toBeUndefined();
    expect(scanLang(argv("plan"))).toBeUndefined();
  });
});
