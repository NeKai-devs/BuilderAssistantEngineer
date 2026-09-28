import { execSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseReview } from "../../../src/review/parse.js";
import { secretKinds } from "../../../src/review/secrets.js";
import { agent, bypassRepo, fake, next, REVIEW_PASS } from "./harness.js";

const IDENTITY = "-c user.name=a -c user.email=a@a -c commit.gpgsign=false";
const KEY = () => fake("AKIA", "Q7R8M3N4A1B2C3D4");

describe("bypass 37: secrets are found where they stay, and look-alikes are not", () => {
  it.each([
    [
      "an .env.example with empty values",
      ".env.example",
      "DB_PASSWORD=\nDB_HOST=localhost\nPORT=3000\n",
    ],
    [
      "a placeholder key in the README",
      "README.md",
      `Set AWS_ACCESS_KEY_ID=${fake("AKIA", "XXXXXXXXXXXXXXXX")}\n`,
    ],
    [
      "a SHA-256 checksum",
      "src/checksums.ts",
      `export const sha = "${"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}";\n`,
    ],
    ["a password rule", "src/rules.ts", 'export const passwordRule = "^(?=.*[A-Z]).{8,}$";\n'],
    [
      "a public certificate",
      "certs/ca.pem",
      "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
    ],
    ["a committed .env.development", ".env.development", "VITE_API_URL=http://localhost:3000\n"],
    [
      "a local connection string in docs",
      "docs/setup.md",
      "postgres://myuser:mypassword@localhost:5432/app\n",
    ],
  ])("lets correct work through with %s", async (_name, path, text) => {
    const cwd = await bypassRepo({ task: { scope: "- everything" } });
    const run = await next(cwd, ["--yes"], [agent(cwd, { [path]: text }), REVIEW_PASS]);
    expect(run.log).not.toContain("looks like a credential");
    expect(run.log).not.toContain("secrets file");
    expect(run.code).toBe(0);
  });

  it("finds a key committed during the task and removed again", async () => {
    const cwd = await bypassRepo();
    const work = agent(cwd, { "src/feature.ts": "export const f = 1;\n" }, async () => {
      await writeFile(join(cwd, "src", "key.ts"), `export const key = "${KEY()}";\n`);
      execSync(`git add -A && git ${IDENTITY} commit -qm key`, { cwd });
      execSync(`git rm -q src/key.ts && git ${IDENTITY} commit -qm cleanup`, { cwd });
    });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("A commit made during the task adds what looks like a credential");
  });

  it("finds a known key in a long line of a new file over a megabyte", async () => {
    const cwd = await bypassRepo();
    const line = `${"x".repeat(1_200_000)} ${fake("AS", "IA", "Q7R8M3N4A1B2C3D4")} ${"y".repeat(5000)}\n`;
    const run = await next(cwd, ["--yes"], [agent(cwd, { "src/bundle.js": line }), REVIEW_PASS]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("AWS access key");
  });

  it("scans long identifier runs in linear time", () => {
    const started = Date.now();
    secretKinds({ path: "src/blob.ts", text: `const a = "${"A1b2".repeat(15_000)}";` });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("does not take a verdict the surrounding text contradicts", () => {
    expect(() => parseReview('Verdict: fail.\n{"verdict": "pass", "findings": []}')).toThrow();
    expect(() => parseReview('{"verdict": "fail", "findings": [], "verdict": "pass"}')).toThrow();
    expect(parseReview('Looks good.\n{"verdict": "pass", "findings": []}').verdict).toBe("pass");
    expect(parseReview('No test fails now.\n{"verdict": "pass", "findings": []}').verdict).toBe("pass");
  });
});
