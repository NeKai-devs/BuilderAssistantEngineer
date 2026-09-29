import { chmod, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { configSchema } from "../../../src/config/schema.js";
import { refusal } from "../../../src/gates/gate.js";
import { checksFor } from "../../../src/next/start.js";
import { commandNotes } from "../../../src/plan/parser.js";
import { parseTask, verificationNotes } from "../../../src/tasks/schema.js";
import type { Step } from "../../fakes.js";
import { gitCommitAll, tempDir, writeFiles } from "../../helpers.js";
import { next, read, statusOf } from "../bypass/harness.js";

const FIXTURE = fileURLToPath(new URL("../../fixtures/plans/python-audit/", import.meta.url));
const TASKS_DIR = "docs/plan/tasks";
const T001 = `${TASKS_DIR}/T-001-establish-local-quality-tooling.md`;

const config = configSchema.parse(
  JSON.parse(await readFile(join(FIXTURE, ".bae", "config.json"), "utf8")),
);
const plan = await Promise.all(
  (await readdir(join(FIXTURE, TASKS_DIR))).sort().map(async (name) => {
    const path = `${TASKS_DIR}/${name}`;
    return { path, text: await readFile(join(FIXTURE, path), "utf8") };
  }),
);
const tasks = plan.map((file) => parseTask(file.path, file.text));

const FAKE_PYTHON = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const [flag, tool, ...rest] = process.argv.slice(2);
const marker = path.join(__dirname, "..", "installed");
const missing = () => {
  console.error(process.argv[1] + ": No module named " + tool);
  process.exit(1);
};
if (flag !== "-m" || !tool) process.exit(2);
if (tool === "pip") {
  fs.writeFileSync(marker, "");
  console.log("Successfully installed python-app");
  process.exit(0);
}
if (tool === "mypy") {
  if (!fs.existsSync(marker)) missing();
  console.log("Success: no issues found in 3 source files");
  process.exit(0);
}
if (tool === "ruff") {
  console.log(rest[0] === "format" ? "3 files already formatted" : "All checks passed!");
  process.exit(0);
}
if (tool !== "pytest") missing();
const files = fs.readdirSync("tests").filter((name) => /^test_.*\\.py$/.test(name));
const cases = files.flatMap((name) =>
  [...fs.readFileSync(path.join("tests", name), "utf8").matchAll(/^def (test_\\w+)/gm)].map(
    (match) => '<testcase classname="tests.' + name.slice(0, -3) + '" name="' + match[1] + '" file="tests/' + name + '"/>',
  ),
);
const xml = /--junitxml="?([^"\\s]+)"?/.exec(process.env.PYTEST_ADDOPTS || "");
if (xml) fs.writeFileSync(xml[1], "<testsuites><testsuite>" + cases.join("") + "</testsuite></testsuites>");
console.log(cases.length + " passed in 0.01s");
`;

const INITIAL = {
  "pyproject.toml":
    '[project]\nname = "python-app"\nversion = "0.1.0"\ndependencies = ["fastapi>=0.110"]\n\n[project.optional-dependencies]\ndev = ["pytest>=8", "ruff>=0.5"]\n\n[tool.ruff]\nline-length = 100\n',
  "README.md": "# python-app\n\nFastAPI service fixture.\n",
  "app/__init__.py": "",
  "app/main.py":
    'from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get("/health")\ndef health():\n    return {"ok": True}\n',
  "tests/test_main.py": "def test_health():\n    assert True\n",
  ".gitignore": ".venv/\n__pycache__/\n*.egg-info/\n.pytest_cache/\n.ruff_cache/\n",
};

const TOOLED = {
  "pyproject.toml":
    '[project]\nname = "python-app"\nversion = "0.1.0"\nrequires-python = ">=3.12"\ndependencies = ["fastapi>=0.110", "uvicorn>=0.30"]\n\n[project.optional-dependencies]\ndev = ["pytest>=8", "ruff>=0.5", "mypy>=1.11", "httpx>=0.27"]\n\n[tool.ruff]\nline-length = 100\ntarget-version = "py312"\n\n[tool.mypy]\npython_version = "3.12"\nstrict = true\nfiles = ["app", "tests"]\nplugins = ["pydantic.mypy"]\n',
  "README.md":
    "# python-app\n\nFastAPI service fixture.\n\n## Development\n\n| Purpose | Command |\n| --- | --- |\n| Format check | `.venv/bin/python -m ruff format --check .` |\n| Typecheck | `.venv/bin/python -m mypy` |\n",
  "tests/test_main.py":
    'from fastapi.testclient import TestClient\n\nfrom app.main import app\n\n\ndef test_health_returns_ok() -> None:\n    response = TestClient(app).get("/health")\n    assert response.status_code == 200\n',
};

const JUSTIFIED: Step = () =>
  JSON.stringify({
    verdict: "pass",
    findings: [
      {
        severity: "minor",
        file: "tests/test_main.py",
        message: "Replaces the placeholder test with a real /health test, as the task asks.",
      },
    ],
  });

async function pythonApp(): Promise<string> {
  const cwd = await tempDir();
  await writeFiles(cwd, {
    ...INITIAL,
    ...Object.fromEntries(plan.map((file) => [file.path, file.text])),
    ".bae/config.json": await readFile(join(FIXTURE, ".bae", "config.json"), "utf8"),
    "AGENTS.md": "# Rules\n",
    ".claude/agents/reviewer.md":
      "---\nname: reviewer\ndescription: Strict\n---\nReject shortcuts.",
    ".venv/bin/python": FAKE_PYTHON,
  });
  await chmod(join(cwd, ".venv", "bin", "python"), 0o755);
  await gitCommitAll(cwd, "plan");
  return cwd;
}

function tooling(cwd: string): Step {
  return async () => {
    await writeFiles(cwd, { ...TOOLED, ".venv/installed": "" });
    const text = await read(cwd, T001);
    await writeFiles(cwd, {
      [T001]: `${text.trimEnd()}\nAdded mypy, httpx and a real /health test; README lists the checks.\n`,
    });
    return "";
  };
}

describe("the python plan from the 0.3.2 audit runs unattended (A1)", () => {
  it.each(tasks.map((task) => [task.meta.id, task] as const))(
    "%s passes the checks next applies when nobody confirms them",
    (_id, task) => {
      const checks = checksFor(task, config);
      const policy = { unattended: true, allow: config.verify.allow, bash: "bash" };
      expect(refusal(checks, policy)).toBeUndefined();
    },
  );

  it.each(tasks.map((task) => [task.meta.id, task] as const))(
    "%s passes plan validation with the same list",
    (_id, task) => {
      expect(verificationNotes(task, config.verify.allow)).toEqual([]);
    },
  );

  it("keeps its project commands, which run through the repository's virtualenv", () => {
    expect(commandNotes(config.commands, config.verify.allow)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "takes T-001 to done while mypy, which T-001 installs, does not exist yet",
    async () => {
      const cwd = await pythonApp();
      const run = await next(cwd, ["--headless", "--yes"], [tooling(cwd), JUSTIFIED]);
      expect(run.log).not.toContain("is not on the list of commands bae runs");
      expect(run.log).toContain(
        "`.venv/bin/python -m mypy` does not exist yet (its tool or script is not installed or written)",
      );
      expect(run.log).not.toContain("gives no usable baseline");
      expect(run.code).toBe(0);
      expect(await statusOf(cwd, T001)).toBe("done");
    },
  );
});
