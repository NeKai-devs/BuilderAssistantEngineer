# ADR-002: Tooling, quality gates and the agent workflow

- Status: Accepted
- Date: 2026-09-26

## Context
AI agents write most of the code. The only thing that keeps quality steady across sessions is a set of fast, strict, automated gates, plus small tasks with explicit acceptance criteria.

## Decision
- **uv** manages Python 3.12 (via `.python-version`) and the dependencies. `uv.lock` is committed, and CI and the Docker image install with `--locked`.
- **ruff** handles linting and formatting. **mypy** runs strict, with django-stubs. Tests use **pytest**, pytest-django and pytest-cov, plus time-machine and BeautifulSoup.
- Coverage gates: 85% overall, and 100% for `core/dates.py` and `core/streaks.py`.
- `make check` runs the standard gates listed in AGENTS.md. GitHub Actions runs the same gates on SQLite, and the full test suite on PostgreSQL 17.
- Configuration lives in one settings module (`config/settings.py`) driven by environment variables through django-environ. `.env.example` documents every variable.
- Work happens through task files in `docs/plan/tasks/`, each with a status, dependencies, scope, acceptance criteria and verification commands.
- A read-only reviewer subagent must return PASS before a task is marked done.
- Each task ends in one commit: `<type>(<scope>): <summary> (T-NNN)`.
- Agents never push, deploy, or touch external accounts.

## Consequences
- Upsides:
  - regressions show up quickly
  - an agent can resume any task from its file alone
  - the plan's state is always visible through `/status`
- Downside: a small amount of ceremony per task, kept down by the command templates.

## Alternatives considered
- **pip or Poetry:** slower, and weaker locking or Python management.
- **black, flake8 and isort:** three tools where ruff is one.
- **Separate settings modules per environment:** configuration drift. Environment variables are enough.
