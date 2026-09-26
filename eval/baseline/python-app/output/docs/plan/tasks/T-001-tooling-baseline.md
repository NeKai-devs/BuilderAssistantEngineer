---
id: T-001
title: Establish tooling baseline: formatter, type checking, real tests and CI
status: pending
phase: 1
depends_on: []
size: M
risk: low
---
## Goal
When this is done, the repo installs into a Python 3.12 venv and has working gates for lint, formatting, type checking, tests with coverage, and CI. Every later task can then be verified with the same commands.

This closes the baseline gaps:
- A formatter, type checker and CI are absent.
- The only test (`tests/test_main.py:1-2`) is `assert True` and never imports the app.
- `httpx`, which `TestClient` needs, is not declared.
- No ASGI server is declared.

## Context
- Suggested agent: platform.
- Read first: `pyproject.toml:1-10`, `app/main.py:1-8`, `tests/test_main.py:1-2`, `.gitignore:1-2`, `README.md:1-3`, ADR-001, ADR-005.
- **Packaging:**
  - There is no `[build-system]`. Add setuptools.
  - Limit package discovery to `app*`, or setuptools may pick up other top-level directories.
- **Versions:** raise the FastAPI floor to `>=0.115` (query-parameter models, ADR-004), and declare `pydantic>=2.7` explicitly so Pydantic v2 is guaranteed.
- **CI:** there is no git remote (`.git/config`), so GitHub Actions is an assumption. The workflow can't run locally; verify it by its content.
- **`.gitignore`:** currently untracked. Keep its two existing lines.

## Scope
In:
- `pyproject.toml` — packaging, dependencies, ruff, mypy and pytest config
- `app/main.py` — add a return type to `health` only; behavior unchanged
- `tests/test_main.py` — real test
- `.gitignore`
- `.github/workflows/ci.yml` — new
- `README.md` — Development section

Out: any notes feature or DB code; Makefile; pre-commit hooks; lockfile.

## Steps
1. Rewrite `pyproject.toml` to this content (keep `name` and `version`):
   ```toml
   [build-system]
   requires = ["setuptools>=69"]
   build-backend = "setuptools.build_meta"

   [project]
   name = "python-app"
   version = "0.1.0"
   requires-python = ">=3.12"
   dependencies = ["fastapi>=0.115", "pydantic>=2.7", "uvicorn>=0.30"]

   [project.optional-dependencies]
   dev = ["pytest>=8", "pytest-cov>=5", "httpx>=0.27", "ruff>=0.5", "mypy>=1.10"]

   [tool.setuptools.packages.find]
   include = ["app*"]

   [tool.ruff]
   line-length = 100
   target-version = "py312"

   [tool.ruff.lint]
   select = ["E", "F", "I", "UP", "B", "S608"]

   [tool.ruff.lint.flake8-bugbear]
   extend-immutable-calls = ["fastapi.Depends", "fastapi.Query", "fastapi.Path"]

   [tool.mypy]
   python_version = "3.12"
   strict = true
   files = ["app"]
   plugins = ["pydantic.mypy"]

   [tool.pytest.ini_options]
   testpaths = ["tests"]
   pythonpath = ["."]
   addopts = "-ra"
   ```
2. Create the venv and install: `python3.12 -m venv .venv`, then `.venv/bin/python -m pip install -e ".[dev]"`.
3. In `app/main.py`, change `def health():` to `def health() -> dict[str, bool]:`.
4. Replace `tests/test_main.py` with `test_health_returns_ok`: `TestClient(app)` used as a context manager; assert status 200 and JSON `{"ok": True}`.
5. Run `.venv/bin/python -m ruff format .` and fix any `ruff check` findings.
6. Create `.github/workflows/ci.yml`:
   ```yaml
   name: ci
   on:
     push:
       branches: [main]
     pull_request:
   jobs:
     check:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-python@v5
           with:
             python-version: "3.12"
             cache: pip
             cache-dependency-path: pyproject.toml
         - run: python -m pip install -e ".[dev]"
         - run: python -m ruff check .
         - run: python -m ruff format --check .
         - run: python -m mypy
         - run: python -m pytest -q --cov=app --cov-report=term-missing --cov-fail-under=90
   ```
7. Extend `.gitignore` with: `.venv/`, `__pycache__/`, `*.py[cod]`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `.coverage`, `htmlcov/`, `*.egg-info/`, `build/`, `dist/`, `data/`, `*.db`, `*.db-wal`, `*.db-shm`.
8. Rewrite `README.md`: a one-paragraph purpose ("internal notes API"), a Development section (setup and the four check commands), and a Run section (`.venv/bin/python -m uvicorn app.main:app --reload`).

## Acceptance criteria
- [ ] `.venv/bin/python -m pip install -e ".[dev]"` succeeds on Python ≥ 3.12.
- [ ] `pyproject.toml` declares `requires-python = ">=3.12"`; runtime deps `fastapi>=0.115`, `pydantic>=2.7`, `uvicorn>=0.30`; dev deps including `mypy`, `httpx`, `pytest-cov`; and a `[build-system]`.
- [ ] `ruff check .`, `ruff format --check .`, `mypy` (strict, on `app`) and `pytest` with `--cov-fail-under=90` all exit 0.
- [ ] `tests/test_main.py` checks `GET /health` through `TestClient`: status 200, body `{"ok": true}`. The placeholder `assert True` test is gone.
- [ ] `GET /health` behavior is unchanged apart from the type annotation.
- [ ] `.github/workflows/ci.yml` runs on pushes to `main` and on pull requests, uses Python 3.12, and runs the four check commands.
- [ ] `.gitignore` keeps `.bae/runs/` and `.bae/tmp/` and ignores `.venv/`, the caches, `.coverage`, `*.egg-info/`, `data/` and the SQLite files.
- [ ] `README.md` has Development and Run sections containing the commands above.

## Verification
```sh
.venv/bin/python -c "import sys; assert sys.version_info >= (3, 12), sys.version"
.venv/bin/python -c "import fastapi, pydantic, uvicorn, httpx, mypy, pytest_cov; assert pydantic.VERSION.startswith('2')"
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
.venv/bin/python -m mypy
.venv/bin/python -m pytest -q --cov=app --cov-report=term-missing --cov-fail-under=90
grep -q 'python-version: "3.12"' .github/workflows/ci.yml
grep -q "ruff format --check" .github/workflows/ci.yml
grep -q "python -m mypy" .github/workflows/ci.yml
grep -q "cov-fail-under=90" .github/workflows/ci.yml
grep -q "^.venv/" .gitignore
grep -q "^.bae/runs/" .gitignore
grep -q "Development" README.md
```
All commands exit 0. pytest reports 1 passing test, with 100% coverage of `app/main.py`. With the old placeholder test, coverage would collect no data and fail the floor.

## Risks and notes
- If `python3.12` isn't installed locally, any Python ≥ 3.12 is acceptable for development; CI pins 3.12. Record which interpreter you used here.
- Fix mypy strict findings in code; don't relax `strict`.
- If the repo turns out to be hosted somewhere other than GitHub (open question 1), replacing the workflow is a follow-up task.
</br>
