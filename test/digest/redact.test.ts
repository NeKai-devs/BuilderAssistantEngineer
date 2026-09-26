import { describe, expect, it } from "vitest";
import { redact } from "../../src/digest/redact.js";

const fake = (...parts: string[]) => parts.join("");

describe("redact", () => {
  it.each([
    ["AWS access key", fake("AKIA", "ABCDEFGHIJKLMNOP")],
    ["GitHub token", fake("gh", "p_", "a".repeat(36))],
    ["GitHub fine-grained token", fake("github", "_pat_", "A".repeat(30))],
    ["Slack token", fake("xo", "xb-", "1234567890-abcdef")],
    ["OpenAI/Anthropic key", fake("sk-", "ant-", "b".repeat(30))],
    ["Stripe key", fake("sk", "_live_", "c".repeat(24))],
    ["Google API key", fake("AI", "za", "d".repeat(35))],
    ["npm token", fake("npm", "_", "e".repeat(36))],
    ["JWT", fake("eyJ", "hbGciOiJIUzI1", ".", "eyJzdWIiOiIxMjM0", ".", "SflKxwRJSMeKKF2QT4")],
  ])("removes a %s", (_, secret) => {
    expect(redact(`value: ${secret} end`)).toBe("value: [REDACTED] end");
  });

  it("removes private key blocks", () => {
    const block = fake("-----BEGIN ", "PRIVATE KEY-----\nabc\n-----END ", "PRIVATE KEY-----");
    expect(redact(`before\n${block}\nafter`)).toBe("before\n[REDACTED]\nafter");
  });

  it("removes quoted secret assignments but keeps short or unrelated values", () => {
    expect(redact(`const dbPassword = "hunter2hunter2";`)).toBe(`const dbPassword = "[REDACTED]";`);
    expect(redact(`{"apiKey": "abcdefghijkl"}`)).toBe(`{"apiKey": "[REDACTED]"}`);
    expect(redact(`password: string;`)).toBe(`password: string;`);
    expect(redact(`const name = "a-regular-value";`)).toBe(`const name = "a-regular-value";`);
  });

  it("removes env-style assignments", () => {
    expect(redact("export STRIPE_SECRET_KEY=abcdefgh12345\nPORT=3000")).toBe(
      "export STRIPE_SECRET_KEY=[REDACTED]\nPORT=3000",
    );
    expect(redact("//registry.npmjs.org/:_authToken=abc123")).toBe(
      "//registry.npmjs.org/:_authToken=[REDACTED]",
    );
  });

  it("removes credentials embedded in URLs", () => {
    expect(redact("postgres://admin:s3cret@db:5432/app")).toBe("postgres://[REDACTED]@db:5432/app");
  });
});
