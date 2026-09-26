---
id: T-007
title: Make /health check the database and configure application logging
status: pending
phase: 3
depends_on: [T-002]
size: S
risk: low
---
## Goal
When this is done, `/health` reports whether the database can actually be queried, so systemd, operators and load balancers can detect a broken DB. Startup and failure logs show up in journald, with a configurable level.

## Context
- Suggested agent: backend.
- Read first: AGENTS.md; `docs/plan/01-prd.md` (FR-6, Observability); ADR-005; `app/main.py`, `app/config.py`, `app/db.py`, `tests/test_main.py`, `tests/conftest.py`.
- **Keep the healthy response:** 200 `{"ok": true}` stays exactly as today (`app/main.py`). Only the 503 case is new.
- **Don't use `get_conn` in `/health`.** An exception raised inside a dependency can't be caught by the endpoint. Open the connection inside the handler with `db.connect(...)` in a `try` block.
- **What to query:** the check must touch the schema, e.g. `SELECT 1 FROM notes LIMIT 1`. A bare `SELECT 1` succeeds even on an empty or un-migrated file.
- **Log handlers:** uvicorn configures only its own loggers. For `app.*` logs at INFO to appear, call `logging.basicConfig(level=..., format=...)` in the lifespan; it does nothing if the root logger already has handlers (e.g. under pytest). Keep `propagate` at its default so `caplog` works.

## Scope
In:
- `app/config.py`: `log_level`
- `app/main.py`: health check, logging setup, startup log line
- `tests/test_main.py`
- `tests/test_config.py` (new)
- `README.md`: Configuration section

Out: metrics endpoint, structured JSON logging, request-ID middleware.

## Steps
1. `Settings.log_level: str = "INFO"`. `from_env()` reads `NOTES_LOG_LEVEL`, upper-cases it, and checks it is one of `DEBUG`, `INFO`, `WARNING`, `ERROR`. Otherwise it raises `ValueError` naming `NOTES_LOG_LEVEL`.
2. Lifespan:
   - Configure logging.
   - `version = init_db(...)`.
   - `logger.info("notes-api started db_path=%s schema_version=%d", ...)`.
3. `/health`:
   - Takes `request: Request` and `response: Response`.
   - Tries `connect(settings.db_path)` and runs the schema query.
   - On `sqlite3.Error`: log a WARNING containing the exception text, set `response.status_code = 503`, return `{"ok": False}`.
   - Always close the connection.
4. Tests:
   - For the 503 test, after startup set `app.state.settings = Settings(db_path=tmp_path / "unmigrated.db")`.
   - Use `caplog` for the log assertions.

## Acceptance criteria
- [ ] With a migrated DB, `GET /health` returns 200 `{"ok": true}`.
- [ ] With `app.state.settings` pointing at an un-migrated file after startup, `GET /health` returns 503 `{"ok": false}`, and a WARNING record from an `app.*` logger contains the SQLite error text.
- [ ] Startup emits one INFO record containing `notes-api started`, the DB path and `schema_version=1` (checked with `caplog`).
- [ ] `NOTES_LOG_LEVEL=debug` gives `Settings.log_level == "DEBUG"`. `NOTES_LOG_LEVEL=loud` raises a `ValueError` whose message contains `NOTES_LOG_LEVEL`.
- [ ] No log record contains a note title or body. The reviewer checks this by grepping the logger calls in `app/`.
- [ ] `README.md` documents `NOTES_LOG_LEVEL` and the 200/503 semantics of `/health`.
- [ ] All Check commands pass; coverage ≥ 90%.

## Verification
```sh
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
.venv/bin/python -m mypy
.venv/bin/python -m pytest -q tests/test_main.py tests/test_config.py
.venv/bin/python -m pytest -q --cov=app --cov-report=term-missing --cov-fail-under=90
grep -q "NOTES_LOG_LEVEL" README.md
```
All commands exit 0.

## Risks and notes
- Opening a connection in `/health` creates an empty file if the path doesn't exist. The schema query then fails and returns 503, which is the correct signal.
- If a load balancer polls `/health` very often, each poll opens a SQLite connection. That is cheap, but keep the probe interval ≥ 5 s.
</br>
