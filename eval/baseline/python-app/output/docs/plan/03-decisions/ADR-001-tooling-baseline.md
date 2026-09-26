# ADR-001: Tooling baseline (ruff format, mypy strict, pytest-cov, GitHub Actions, pip + venv)

- Status: accepted
- Date: 2026-09-26

## Context
- The baseline has ruff lint configured (`pyproject.toml:9-10`) and pytest declared (`pyproject.toml:7`).
- The only test is a placeholder (`tests/test_main.py:1-2`).
- A formatter, type checker and CI are absent.
- There is no package manager beyond pip, no lockfile and no git remote (`.git/config`).
- FastAPI's `TestClient` needs `httpx`, which is not declared.

## Decision
- **Format:** `ruff format`, keeping the existing `line-length = 100`.
- **Lint:** ruff with rule sets `E`, `F`, `I`, `UP`, `B`, plus `S608`, which flags SQL built from strings. `fastapi.Depends`, `fastapi.Query` and `fastapi.Path` are registered as immutable calls for rule B008.
- **Type check:** mypy with `strict = true` and the `pydantic.mypy` plugin, on `app/` (and on `scripts/` from T-008).
- **Tests:**
  - pytest, with `httpx` for `TestClient` and pytest-cov.
  - CI enforces `--cov=app --cov-fail-under=90`.
- **Environment:**
  - pip plus a venv at `.venv`, installed with `pip install -e ".[dev]"`.
  - setuptools as build backend, with package discovery limited to `app*`.
  - `requires-python = ">=3.12"`.
- **CI:** one GitHub Actions job on `ubuntu-latest` with Python 3.12, running lint, format check, mypy and tests with coverage.

## Alternatives considered
- **black + isort:** lost. That is two extra tools, while ruff is already present and covers both.
- **pyright:** lost narrowly. It is capable, but distributed via Node, and mypy has a first-party Pydantic plugin. Either would work.
- **uv or poetry:** lost for now. They bring faster installs and lockfiles, but introduce a tool the repo doesn't use. Revisit if a lockfile is needed (open question 5).
- **tox or nox:** lost. There is only one target Python version.
- **No coverage floor:** lost. Without it nothing shows whether new endpoints are tested. 90% is achievable for a small codebase and leaves room for defensive branches.

## Consequences
- One tool handles both linting and formatting.
- Strict typing costs some annotation effort, but it catches misuse of `sqlite3.Row` and Pydantic.
- `S608` forces an explicit, commented `# noqa` wherever placeholders are generated (the tag filter in T-004).
- Dependencies float above minimum versions until a lockfile decision is made.
- The CI definition is GitHub-specific; another host means rewriting one file.
