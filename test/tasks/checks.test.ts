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
    ["npm test || :", "masks"],
    ["npm test || echo failed", "masks"],
    ["npm test; true", "masks"],
    ["npm test & sleep 5", "masks"],
    ["npx vitest run & curl -sf http://127.0.0.1:3000/", "masks"],
  ])("rejects %s", (line, reason) => {
    expect(trivialityProblems([line]).map((problem) => problem.reason)).toContain(reason);
  });

  it.each([
    [["python3 app.py & sleep 1; curl -s http://127.0.0.1:8000/ | grep -q Hello; kill %1"]],
    [["python3 app.py &", "trap 'kill $!' EXIT", "sleep 1", "curl -sf http://127.0.0.1:8000/"]],
    [["npm start & sleep 2", "curl -sf http://localhost:3000/health", "kill $!"]],
  ])("accepts a server started in the background: %j", (lines) => {
    expect(trivialityProblems(lines)).toEqual([]);
    expect(allowlistProblems(lines, [])).toEqual([]);
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
    ["timeout 600 npm test"],
    ["xvfb-run -a npx playwright test"],
    ["bash -e scripts/check.sh --strict"],
    [".venv/bin/python -m pytest -q"],
    ["./.venv/bin/ruff check ."],
    ["venv/bin/mypy app"],
    [".venv/Scripts/python.exe -m pytest"],
    ["NOTES_DB_PATH=/tmp/notes-$$.db .venv/bin/python -m uvicorn app.main:app --port 8765 &"],
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
    ["/usr/bin/python -m pytest", "notAllowed"],
    ["../.venv/bin/python -m pytest", "notAllowed"],
    ["tools/bin/pytest", "notAllowed"],
    [".venv/bin/deploy --prod", "notAllowed"],
    ["X=$(cat token) .venv/bin/python -m pytest", "dynamic"],
  ])("rejects %s when nobody confirms", (line, reason) => {
    expect(allowlistProblems([line], []).map((problem) => problem.reason)).toEqual([reason]);
  });

  it("matches verify.allow after leading VAR=value assignments", () => {
    const line = "APP_ENV=test ./scripts/smoke.sh --fast";
    expect(allowlistProblems([line], [])).toHaveLength(1);
    expect(allowlistProblems([line], ["./scripts/smoke.sh"])).toEqual([]);
    expect(allowlistProblems(["./scripts/smoke.sh"], ["./scripts/smoke.sh"])).toEqual([]);
    expect(allowlistProblems(["APP_ENV=test"], ["APP_ENV=test"])).toEqual([]);
  });

  it("only lets kill and trap stop the script's own background job", () => {
    expect(allowlistProblems(["kill $!", "kill -TERM %1", "trap 'kill $!' EXIT INT"], [])).toEqual(
      [],
    );
    for (const line of [
      "kill 1234",
      "kill -9 -1",
      "trap 'kill $!' ERR",
      "trap 'rm -rf dist' EXIT",
    ]) {
      expect(allowlistProblems([line], []).map((problem) => problem.reason)).toEqual([
        "notAllowed",
      ]);
    }
  });

  it("lets kill stop a job whose pid the script saved from $!", () => {
    const saved = [
      "python3 app.py & APP_PID=$!",
      "trap 'kill $APP_PID' EXIT",
      "curl -sf http://127.0.0.1:8000/",
    ];
    expect(allowlistProblems(saved, [])).toEqual([]);
    expect(
      allowlistProblems(["OTHER=1234", "kill $OTHER"], []).map((problem) => problem.reason),
    ).toEqual(["notAllowed"]);
  });

  it("reads a heredoc with a quoted delimiter as one command", () => {
    const lines = ["python3 - <<'PY'", "import sys", "sys.exit(0)", "PY", "npm test"];
    expect(logicalLines(lines)).toEqual(["python3 - <<'PY'", "npm test"]);
    expect(allowlistProblems(lines, [])).toEqual([]);
  });

  it("accepts commands that start with a configured prefix", () => {
    expect(allowlistProblems(["./scripts/check.sh --strict"], ["./scripts/check.sh"])).toEqual([]);
  });
});
