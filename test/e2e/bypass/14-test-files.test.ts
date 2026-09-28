import { describe, expect, it } from "vitest";
import { agent, bypassRepo, next, REVIEW_PASS } from "./harness.js";

describe("bypass 14: tests: required recognizes real tests, and only real tests", () => {
  it.each([
    [
      "Rust inline tests",
      "src/lib.rs",
      "#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() { assert_eq!(2, 1 + 1); }\n}\n",
    ],
    [
      "a Cypress spec",
      "cypress/e2e/login.cy.ts",
      "it('logs in', () => { cy.get('#user').should('be.visible'); });\n",
    ],
    ["an e2e folder", "e2e/checkout.ts", "test('pays', async () => { expect(total).toBe(3); });\n"],
    [
      "a Go test",
      "pkg/feature_test.go",
      'func TestX(t *testing.T) { if 1 != 1 { t.Fatal("x") } }\n',
    ],
    ["a pytest file", "tests/test_feature.py", "def test_x():\n    assert 1 == 1\n"],
  ])("passes a tests: required task that adds %s", async (_, path, content) => {
    const cwd = await bypassRepo({ task: { tests: "required", scope: "- `src/`" } });
    const run = await next(
      cwd,
      ["--yes"],
      [agent(cwd, { "src/feature.ts": "x\n", [path]: content }), REVIEW_PASS],
    );
    expect(run.code).toBe(0);
  });

  it("does not accept a test file without assertions", async () => {
    const cwd = await bypassRepo({ task: { tests: "required" } });
    const run = await next(
      cwd,
      ["--yes"],
      [agent(cwd, { "src/feature.ts": "x\n", "test/empty.test.ts": "// todo\n" })],
    );
    expect(run.code).toBe(1);
    expect(run.log).toContain("The task requires tests (tests: required)");
  });
});
