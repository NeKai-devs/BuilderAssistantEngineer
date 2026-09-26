---
id: T-002
title: Add GitHub Actions CI running the gates on SQLite and PostgreSQL 17
status: pending
phase: 1
depends_on: [T-001]
size: S
risk: low
---
## Goal
Every push to `main` and every pull request runs the standard gates. The full test suite also runs against PostgreSQL 17, so behaviour that only works on SQLite is caught before it reaches production.

## Context
- Read: ADR-002, ADR-003, `AGENTS.md` (Standard gates), `Makefile`, `pyproject.toml`.
- Gotchas:
  - Use `astral-sh/setup-uv` pinned to a major version, with caching turned on. uv reads `.python-version`, so no separate Python setup action is needed.
  - The Postgres service container is `postgres:17` with a `pg_isready` health check. Use `DATABASE_URL=postgres://postgres:postgres@localhost:5432/teamhabits`.
  - Check the action versions and inputs against each action's README at implementation time.

## Scope
In:
- `.github/workflows/ci.yml`:
  - triggers: `push` to `main` and `pull_request`
  - `concurrency` per ref with `cancel-in-progress: true`
  - `permissions: contents: read`
  - job `checks` (ubuntu-latest): checkout, setup-uv, then the standard gates exactly as in AGENTS.md (SQLite)
  - job `postgres`: `postgres:17` service, `uv sync --locked`, then `uv run pytest -q` with `DATABASE_URL` set
- `README.md`: a "CI" section describing both jobs and how to run the Postgres suite locally

Out: deployment (Render deploys from `main`, see T-009); the dependency audit (T-016).

## Steps
1. Write the workflow with both jobs.
2. Lint it with actionlint.
3. If Docker is available, run the suite against a local Postgres 17: `docker run -d --rm --name th-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=teamhabits -p 5432:5432 postgres:17`, then `DATABASE_URL=postgres://postgres:postgres@localhost:5432/teamhabits uv run pytest -q`.
4. Document the local Postgres run in the README.

## Acceptance criteria
- [ ] `.github/workflows/ci.yml` defines the jobs `checks` and `postgres`. It runs on pushes to `main` and on pull requests, with read-only `contents` permission.
- [ ] `checks` runs exactly the standard gates, the same commands as `make check`.
- [ ] `postgres` uses a `postgres:17` service with a health check and runs the full test suite with `DATABASE_URL`.
- [ ] Actions are pinned to major versions, and there are no piped installers.
- [ ] actionlint reports no errors.
- [ ] The test suite passes against PostgreSQL 17 locally. If Docker is unavailable, record "verified by the first CI run" in the Completion notes once the human confirms it.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest --cov
uvx --from actionlint-py actionlint .github/workflows/ci.yml
test -f .github/workflows/ci.yml
```
Every command exits 0. The actionlint line needs network access the first time it runs.

## Risks and notes
- Human action: create the GitHub repository, push, and confirm both jobs are green. Optionally, require both jobs through branch protection on `main`.
