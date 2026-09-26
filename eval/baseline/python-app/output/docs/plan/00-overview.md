# Notes API: plan overview

## Goal
Turn the existing FastAPI service into a small internal notes API. It will create, list, update and delete notes with tags, store them in SQLite, and run on Linux servers with Python 3.12.
- **First deliverable:** CRUD with validation and tests.
- **Out of scope:** authentication and a web UI (per the brief).

## Starting point
- `app/main.py:1-8` defines a single `FastAPI()` app with `GET /health`.
- `tests/test_main.py:1-2` is a placeholder (`assert True`) that never imports the app.
- `pyproject.toml:1-10` declares only `fastapi>=0.110`, with pytest and ruff as dev dependencies.
- There is no formatter, type checker, CI, persistence or ASGI server dependency.

See `02-architecture.md` for the full current state.

## Approach
- **Keep:** FastAPI and the existing ruff setting (line length 100).
- **Tooling first:** T-001 adds `ruff format`, strict mypy, real tests with a 90% coverage floor, and GitHub Actions CI (ADR-001).
- **Persistence:**
  - Built-in `sqlite3`, with all SQL in one repository module and schema versions tracked by `PRAGMA user_version` (ADR-002).
  - Tags stored in a `note_tags` join table (ADR-003).
- **API:**
  - REST contract that keeps FastAPI's default error shapes; PATCH for updates; offset pagination; tag filters combine with AND (ADR-004).
  - App factory with migrations at startup; one uvicorn worker managed by systemd (ADR-005).
- **Delivery:** vertical slices, each ending in a demoable, tested state.

## Phases
| Phase | Outcome | Tasks | Demo |
| --- | --- | --- | --- |
| 1 | Tooling baseline; notes can be created and read back from SQLite | T-001, T-002, T-003 | POST a note with tags, GET it back, restart the server, GET again: it is still there |
| 2 | Complete CRUD with validation (first deliverable) | T-004, T-005, T-006 | List with pagination and tag filter; PATCH; DELETE; all checks green, coverage ≥ 90% |
| 3 | Operable on Linux servers | T-007, T-008 | `scripts/smoke.py` passes against a live uvicorn process; `/health` returns 503 when the DB is broken; systemd unit and ops guide |

Eight tasks in total. The dependency graph and task index are in `04-roadmap.md`.

## Documents
- `01-prd.md`: requirements, validation rules, API table, assumptions.
- `02-architecture.md`: current state (with evidence), target state, migration path.
- `03-decisions/`: ADR-001 to ADR-005.
- `04-roadmap.md`: phases, demo criteria, dependency graph, task index.
- `tasks/`: one file per task; each file holds that task's status.

## Top risks
1. **No authentication.** Anyone who can reach the port can read, change or delete every note. The only protection is network placement: bind to localhost or an internal interface, and firewall it (documented in T-008).
2. **SQLite write concurrency.** Several processes writing at once can produce `database is locked` errors, and two processes starting together can race on migrations. Mitigations: one worker, WAL mode, a busy timeout, and migrations that take the write lock first (`BEGIN IMMEDIATE`).
3. **Unconfirmed assumptions.** The CI host is a guess (no git remote), the validation limits are my choice, and there is no lockfile. See the open questions in `01-prd.md`.

## How to execute
Open a session in the repo and run `/next`. It takes the lowest-ID eligible task, implements and verifies it, runs the reviewer, marks the task done and commits. `/status` shows progress. The same commands exist for opencode.
