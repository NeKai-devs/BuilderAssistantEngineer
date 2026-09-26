import { describe, expect, it } from "vitest";
import type { TaskChanges } from "../../src/review/changes.js";
import { secretFindings, secretKinds } from "../../src/review/secrets.js";

const join = (...parts: string[]) => parts.join("");
const kinds = (path: string, text: string) => secretKinds({ path, text });

describe("secretKinds", () => {
  it("ignores the documented example keys and Stripe test keys", () => {
    expect(kinds("src/aws.ts", `const id = "${join("AKIA", "IOSFODNN7EXAMPLE")}";`)).toEqual([]);
    expect(
      kinds(
        "test/pay.test.ts",
        `const key = "${join("sk_", "test_", "4eC39HqLyjWDarjtT1zdp7dc")}";`,
      ),
    ).toEqual([]);
    expect(kinds("src/aws.ts", `const id = "${join("AKIA", "ABCDEFGHIJKLMNOP")}";`)).toEqual([
      "AWS access key",
    ]);
  });

  it("finds hard-coded passwords in source but not placeholders, env reads or tests", () => {
    expect(kinds("src/db.ts", `const password = "${join("hunter2", "hunter2")}";`)).toEqual([
      "hardcoded password or key",
    ]);
    expect(kinds("src/db.ts", 'const password = "changeme";')).toEqual([]);
    expect(kinds("src/db.ts", 'const apiKey = process.env.API_KEY ?? "fallback-value";')).toEqual(
      [],
    );
    expect(
      kinds(
        "test/login.test.ts",
        `login("${join("correct", "horse")}", { password: "${join("battery", "staple")}" });`,
      ),
    ).toEqual([]);
  });

  it("finds credentials in connection strings", () => {
    expect(
      kinds(
        "config/db.yml",
        `url: ${join("postgres://app:", "s3cr3t-Pass", "@db.internal:5432/app")}`,
      ),
    ).toEqual(["credentials in a connection string"]);
    const variable = join("$", "{DB_PASSWORD}");
    expect(kinds("config/db.yml", `url: postgres://app:${variable}@db:5432/app`)).toEqual([]);
    expect(kinds("README.md", "postgres://user:password@localhost:5432/app")).toEqual([]);
  });

  it("finds long random strings but not integrity hashes", () => {
    const blob = join("q8Zr3LkP0vWm7Yt2Xn5", "Bc9Hd4Jf6Gs1Ka8Qe3RwTu7Vy");
    expect(kinds("src/client.ts", `const signingKey = "${blob}";`)).toContain("long random string");
    expect(kinds("src/client.ts", `const sri = "sha512-${blob}";`)).toEqual([]);
  });
});

describe("secretFindings", () => {
  it("skips paths listed in secrets.allow", () => {
    const changes: TaskChanges = {
      files: ["test/fixtures/keys/id_rsa"],
      added: [{ path: "test/fixtures/aws.txt", text: join("AKIA", "ABCDEFGHIJKLMNOP") }],
      removed: [],
      deleted: [],
      untracked: [],
    };
    expect(secretFindings(changes, { allow: [] })).toHaveLength(2);
    expect(secretFindings(changes, { allow: ["test/fixtures/**"] })).toEqual([]);
  });
});
