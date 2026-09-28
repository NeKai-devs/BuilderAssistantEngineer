import { describe, expect, it } from "vitest";
import { agent, bypassRepo, fake, next, REVIEW_PASS } from "./harness.js";

describe("bypass 13: secrets are found without blocking known examples", () => {
  it("accepts the documented example keys in tests", async () => {
    const cwd = await bypassRepo({ task: { scope: "- `src/`" } });
    const work = agent(cwd, {
      "src/feature.ts": "export const f = 1;\n",
      "test/pay.test.ts": `const key = "${fake("sk_", "test_", "4eC39HqLyjWDarjtT1zdp7dc")}";\nconst id = "${fake("AKIA", "IOSFODNN7EXAMPLE")}";\nexpect(key).toBeTruthy();\n`,
    });
    const run = await next(cwd, ["--yes"], [work, REVIEW_PASS]);
    expect(run.code).toBe(0);
  });

  it("blocks hard-coded passwords and credentials in connection strings", async () => {
    const cwd = await bypassRepo();
    const work = agent(cwd, {
      "src/feature.ts": `export const password = "${fake("hunter2", "hunter2")}";\nexport const db = "${fake("postgres://app:", "s3cr3t-Pass", "@db.internal/app")}";\n`,
    });
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(run.log).toContain(
      "src/feature.ts: Adds what looks like a credential (hardcoded password or key, credentials in a connection string)",
    );
  });

  it("finds a key in a new file larger than a megabyte", async () => {
    const cwd = await bypassRepo();
    const filler = "x".repeat(1_200_000);
    const work = agent(cwd, {
      "src/feature.ts": "export const f = 1;\n",
      "src/data.txt": `${filler}\nkey=${fake("AKIA", "ABCDEFGHIJKLMNOP")}\n`,
    });
    const run = await next(cwd, ["--yes"], [work]);
    expect(run.code).toBe(1);
    expect(run.log).toContain("src/data.txt: Adds what looks like a credential (AWS access key)");
  });

  it("lets the user accept a false positive by its id, and records it", async () => {
    const cwd = await bypassRepo();
    const work = agent(cwd, {
      "src/feature.ts": `export const password = "${fake("fixture", "-value-1")}";\n`,
    });
    const first = await next(cwd, ["--yes"], [work]);
    expect(first.code).toBe(1);
    const id = /\((secret-[0-9a-f]{8})\) src\/feature\.ts/.exec(first.log)?.[1] ?? "";
    const second = await next(cwd, ["--yes", "--accept-finding", id], [work, REVIEW_PASS]);
    expect(second.code).toBe(0);
    const { attempts } = await import("./harness.js");
    expect((await attempts(cwd)).at(-1).accepted).toEqual([id]);
  });
});
