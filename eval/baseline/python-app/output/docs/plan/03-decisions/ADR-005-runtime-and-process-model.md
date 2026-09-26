# ADR-005: Environment-based settings, app factory with startup migrations, single uvicorn worker under systemd

- Status: accepted
- Date: 2026-09-26

## Context
- The app is a module-level singleton with no configuration (`app/main.py:3`), and no ASGI server is declared (`pyproject.toml:4`).
- It must run on Linux servers with Python 3.12, and tests need an isolated DB for each test.
- SQLite allows one writer at a time.

## Decision
- **Settings:**
  - `app/config.py` defines a frozen dataclass `Settings`, built by `Settings.from_env()` from `NOTES_DB_PATH` (default `data/notes.db`) and `NOTES_LOG_LEVEL` (added in T-007, default `INFO`).
  - No `pydantic-settings`.
- **App factory:**
  - `create_app(settings: Settings | None = None) -> FastAPI` stores the settings in `app.state.settings`.
  - The lifespan runs `init_db()`, which creates the parent directory, sets WAL mode and applies migrations.
  - Module-level `app = create_app()` lets `uvicorn app.main:app` work. Importing has no side effects on disk.
- **Server:** `uvicorn>=0.30` as a runtime dependency, run with `--workers 1`.
- **Deployment (assumed, open question 2):**
  - A Python 3.12 venv in `/opt/notes-api`, run by a systemd unit (`deploy/notes-api.service`) as a dedicated user.
  - `StateDirectory=notes-api`, which holds `/var/lib/notes-api/notes.db`.
  - Binds to `127.0.0.1`; systemd hardening options enabled. No container.

## Alternatives considered
- **pydantic-settings:** lost. It is an extra dependency for two variables.
- **gunicorn with uvicorn workers, or `--workers N`:** lost. Several processes contend for SQLite's single writer, and there's no throughput need.
- **Migrations as a separate CLI step:** lost. It adds a step operators can forget. Startup migration is safe because it uses `BEGIN IMMEDIATE`.
- **Docker image:** deferred until the deployment model is confirmed.

## Consequences
- Tests build their own app with `create_app(Settings(db_path=tmp_path / "notes.db"))`, and no global state leaks between tests.
- Throughput is limited to one process. That is fine for internal use; scaling out would need a server database (a new ADR).
- Operators need a backup routine for one file (documented in T-008).
