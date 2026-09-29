---
id: T-001
title: Establish local formatter, typecheck and test-client tooling
status: pending
phase: 1
depends_on: []
size: S
risk: medium
tests: optional
type: chore
---
## Goal

The repo gets local formatter and type checker commands, plus the dependencies that later tasks need: httpx for `TestClient` and uvicorn to run the server. The placeholder test becomes a real health test. Afterwards, `ruff check`, `ruff format --check`, `mypy` and `pytest` all pass locally. No CI files are created, because CI is managed by another team.

## Context

- Read `AGENTS.md` and `docs/plan/03-decisions/ADR-001-local-quality-tooling.md`.
- `pyproject.toml:1-10`: runtime dependencies are only `fastapi>=0.110`, dev dependencies are `pytest>=8` and `ruff>=0.5`, and `[tool.ruff] line-length = 100` must be kept.
- `app/main.py:6-8`: `def health():` has no return annotation, which mypy strict rejects. Add `-> dict[str, bool]` and change nothing else.
- `tests/test_main.py:1-2`: the placeholder `assert True`.
- `fastapi.testclient.TestClient` imports httpx, which is not declared yet.
- The project is already installed in editable mode in the local virtualenv, so reinstall it after editing `pyproject.toml`.

## Scope

In:
- `pyproject.toml`
- `app/main.py`
- `tests/test_main.py`
- `README.md`

Out:
- Any CI configuration (a .github/ directory, .gitlab-ci.yml and similar).
- `.gitignore`.
- New modules under `app/`.
- Any change to the `/health` response.
- Changing `line-length`.

## Steps

1. If the virtualenv is missing, create it with `python3.12 -m venv .venv`.
2. Edit `pyproject.toml`:
   - add `requires-python = ">=3.12"`
   - dependencies become `["fastapi>=0.110", "uvicorn>=0.30"]`
   - dev dependencies become `["pytest>=8", "ruff>=0.5", "mypy>=1.11", "httpx>=0.27"]`
   - under `[tool.ruff]`, keep `line-length = 100` and add `target-version = "py312"`
   - add `[tool.ruff.lint] extend-select = ["I", "UP"]`
   - add `[tool.mypy]` with `python_version = "3.12"`, `strict = true`, `files = ["app", "tests"]` and `plugins = ["pydantic.mypy"]`
   - add `[tool.pytest.ini_options] testpaths = ["tests"]`
3. Run `.venv/bin/python -m pip install -e '.[dev]'`.
4. Annotate `health()` in `app/main.py` with `-> dict[str, bool]`.
5. Rewrite `tests/test_main.py`. `test_health_returns_ok() -> None` uses `TestClient(app)` to call `GET /health` and asserts `response.status_code == 200` and `response.json() == {"ok": True}`.
6. Run `ruff check --fix .` and `ruff format .`, then `mypy` and `pytest`, and fix any findings.
7. Add a "Development" section to `README.md` covering venv setup, the install command and the four commands (lint, format check, typecheck, test). Also state that CI lives outside this repository.

## Acceptance criteria

- [ ] `pyproject.toml`:
  - [ ] declares `requires-python = ">=3.12"`
  - [ ] has `uvicorn` in dependencies
  - [ ] has `mypy` and `httpx` in the dev extra
  - [ ] still has `line-length = 100`
  - [ ] has a `[tool.mypy]` section with `strict = true` and the `pydantic.mypy` plugin
  - [ ] has `[tool.pytest.ini_options]` with `testpaths`
- [ ] `.venv/bin/python -m ruff check .`, `.venv/bin/python -m ruff format --check .` and `.venv/bin/python -m mypy` all exit 0.
- [ ] `tests/test_main.py` calls `GET /health` through `TestClient` and asserts a 200 status and the `{"ok": True}` body. The test passes.
- [ ] `app/main.py` behavior is unchanged; only the return annotation was added.
- [ ] `README.md` documents the setup and the four commands.
- [ ] No CI files exist: there is no .github/ directory and no .gitlab-ci.yml.

## Verification

```sh
.venv/bin/python -m pip install -e '.[dev]'
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
.venv/bin/python -m mypy
.venv/bin/python -m pytest -q tests/test_main.py
grep -q 'requires-python = ">=3.12"' pyproject.toml
grep -q 'line-length = 100' pyproject.toml
grep -q 'strict = true' pyproject.toml
grep -q 'pydantic.mypy' pyproject.toml
grep -q 'uvicorn' pyproject.toml
grep -q 'httpx' pyproject.toml
grep -q 'status_code == 200' tests/test_main.py
grep -q 'mypy' README.md
grep -q 'ruff format --check' README.md
test ! -e .github
test ! -e .gitlab-ci.yml
```

Expected: the install succeeds, all three tool invocations exit 0, one test passes, and every grep and `test` line exits 0.

## Risks and notes

- `pip install` needs network access to PyPI. Run the install yourself early in the session, because the runner may run the test gate before this Verification block, and the rewritten test imports httpx.
- If `pip install -e` fails with "Multiple top-level packages discovered", add `[tool.setuptools] packages = ["app"]` to `pyproject.toml`, which is in scope.
- If a newer mypy reports errors from the pydantic plugin inside third-party code, fix the configuration, not by lowering `strict`.

## Log
