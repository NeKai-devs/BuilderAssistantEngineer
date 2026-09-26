import { describe, expect, it } from "vitest";
import { secretKinds } from "../../../src/review/secrets.js";
import { agent, bypassRepo, fake, handoff, next } from "./harness.js";

const kinds = (path: string, text: string) => secretKinds({ path, text });

describe("bypass 27: more secrets are found, fewer labels are mistaken for them", () => {
  it("finds tokens, JWTs, GitLab tokens and secrets in test-named folders", () => {
    expect(kinds("src/api.ts", `const token = "${fake("tok_", "9f8e7d6c5b4a3f2e")}";`)).toContain(
      "hardcoded password or key",
    );
    const jwt = fake(
      "eyJhbGciOiJIUzI1NiJ9",
      ".eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      ".dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    );
    expect(kinds("src/auth.ts", `const t = "${jwt}";`)).toContain("JWT");
    expect(kinds("src/gl.ts", `const t = "${fake("glpat-", "abcdefghij1234567890")}";`)).toContain(
      "GitLab token",
    );
    expect(
      kinds("config/test/prod.ts", `export const password = "${fake("Pr0d", "Secret99")}";`),
    ).toContain("hardcoded password or key");
  });

  it("does not mistake labels, routes or file names for passwords", () => {
    expect(kinds("src/i18n.ts", 'export const password_label = "Contraseña";')).toEqual([]);
    expect(kinds("src/routes.ts", 'export const passwordReset = "/password/reset";')).toEqual([]);
    expect(kinds("src/files.ts", 'export const secretFile = "secrets.yaml";')).toEqual([]);
  });

  it("scans the task's own Log for secrets", async () => {
    const cwd = await bypassRepo();
    const work = agent(cwd, { "src/feature.ts": "x\n" }, () =>
      handoff(cwd, `Used key ${fake("AKIA", "ABCDEFGHIJKLMNOP")} to test.`),
    );
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      "docs/plan/tasks/T-001-first.md: Adds what looks like a credential (AWS access key)",
    );
  });

  it("finds a long random string on a line without keywords in a file over a megabyte", async () => {
    const cwd = await bypassRepo();
    const blob = `export const k = "${fake("Zq8Lm3Xv9Tr2Wp7Ny4Kd6Hs1", "Bf5Gj0Qc8Ue3Ra7Mo2Ti9Vx4")}";\n`;
    const work = agent(cwd, {
      "src/feature.ts": "x\n",
      "src/data.ts": `${"// pad\n".repeat(200_000)}${blob}`,
    });
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      "src/data.ts: Adds what looks like a credential (long random string)",
    );
  });
});
