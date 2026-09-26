---
id: T-002
title: Add SQLite persistence layer, settings and app factory with startup migrations
status: pending
phase: 1
depends_on: [T-001]
size: M
risk: medium
---
## Goal
When this is done, the app has a configurable SQLite database, and schema v1 (`notes`, `note_tags`) is created at startup by versioned migrations. There is a per-request connection dependency, and fixtures give each test an isolated DB. Every note endpoint builds on this.

## Context
- Suggested agent: backend.
- Read first: AGENTS.md (Conventions); `app/main.py`; `tests/test_main.py`; ADR-002, ADR-003, ADR-005; the schema in `docs/plan/02-architecture.md`.
- **Gotchas:**
  - **Threads:** FastAPI runs a generator dependency's setup, the endpoint and the teardown in threadpool threads that may differ, so open connections with `check_same_thread=False`.
  - **Foreign keys:** `PRAGMA foreign_keys` is per connection and off by default. Without it, `ON DELETE CASCADE` silently does nothing.
  - **Journal mode:** `PRAGMA journal_mode = WAL` can't run inside a transaction. Set it before `BEGIN IMMEDIATE`.
  - **`executescript()`:** it commits implicitly. Run migration statements one at a time with `execute()`.
  - **Startup race:** two processes starting at once can both read `user_version = 0`. Take the write lock with `BEGIN IMMEDIATE`, then read `user_version` inside the transaction.
  - **Lifespan:** `TestClient(app)` runs the lifespan only when used as a context manager.
  - **In-memory DBs:** `:memory:` doesn't work with per-request connections; use files under `tmp_path`.

## Scope
In:
- `app/config.py` (new)
- `app/db.py` (new)
- `app/main.py` — factory and lifespan; `/health` unchanged
- `tests/conftest.py` (new)
- `tests/test_db.py` (new)
- `tests/test_main.py` — use the fixture
- `README.md` — Configuration section

Out: note schemas, repository and routes (T-003 onward); DB-aware health check and logging (T-007).

## Steps
1. `app/config.py`: `@dataclass(frozen=True) class Settings: db_path: Path`, plus a classmethod `from_env()` that reads `NOTES_DB_PATH` (default `data/notes.db`).
2. `app/db.py`:
   - `MIGRATIONS: list[list[str]]`. Migration 1 holds the four statements from `docs/plan/02-architecture.md`: table `notes`, index `idx_notes_updated_at`, table `note_tags ... WITHOUT ROWID`, index `idx_note_tags_tag`.
   - `connect(path: Path) -> sqlite3.Connection`: `sqlite3.connect(path, check_same_thread=False)`, `row_factory = sqlite3.Row`, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000`.
   - `init_db(path: Path) -> int`, in this order:
     1. `path.parent.mkdir(parents=True, exist_ok=True)`
     2. Connect and set `isolation_level = None`.
     3. `PRAGMA journal_mode = WAL`
     4. `BEGIN IMMEDIATE`
     5. Read `user_version`.
     6. Run each pending migration statement.
     7. `PRAGMA user_version = <len(MIGRATIONS)>`
     8. `COMMIT`, with `ROLLBACK` on any exception.
     9. Close the connection and return the version.
   - `get_conn(request: Request) -> Iterator[sqlite3.Connection]`: yields `connect(request.app.state.settings.db_path)` and closes it in `finally`.
   - `Conn = Annotated[sqlite3.Connection, Depends(get_conn)]`.
3. `app/main.py`:
   - `create_app(settings: Settings | None = None) -> FastAPI`, using `settings or Settings.from_env()`.
   - Store the settings in `app.state.settings`.
   - An `asynccontextmanager` lifespan that calls `init_db`.
   - Register `/health` inside the factory.
   - Module level: `app = create_app()`.
4. `tests/conftest.py`: fixtures
   - `settings(tmp_path)` returns `Settings(db_path=tmp_path / "notes.db")`
   - `app(settings)` returns `create_app(settings)`
   - `client(app)` yields `TestClient(app)` inside `with`
   - `db_conn(settings, client)` yields `connect(settings.db_path)` and closes it afterwards
5. `tests/test_db.py` covers every acceptance criterion below. `tests/test_main.py` uses `client`.
6. `README.md`: add a Configuration section documenting `NOTES_DB_PATH`.

## Acceptance criteria
- [ ] `Settings.from_env()` returns `Path("data/notes.db")` when `NOTES_DB_PATH` is unset, and the env value when it is set (tested with `monkeypatch`).
- [ ] `create_app(Settings(db_path=p))` creates no file. Entering `TestClient` on that app creates `p` (tested).
- [ ] After startup on a fresh path:
  - `PRAGMA user_version` returns 1.
  - Tables `notes` and `note_tags` and indexes `idx_notes_updated_at` and `idx_note_tags_tag` exist (checked against `sqlite_master`).
  - `PRAGMA journal_mode` returns `wal`.
- [ ] Calling `init_db` twice on the same file returns 1 both times without error.
- [ ] Calling `init_db` from 2 threads at once on a fresh file (synchronized with `threading.Barrier`): both calls succeed, and `user_version` is 1.
- [ ] Missing parent directories are created (`tmp_path / "a" / "b" / "notes.db"`).
- [ ] A connection from `connect()` reports `PRAGMA foreign_keys` = 1 and `PRAGMA busy_timeout` = 5000.
- [ ] Deleting a `notes` row with raw SQL removes its `note_tags` rows (cascade test).
- [ ] `GET /health` still returns 200 `{"ok": true}`, tested through the `client` fixture.
- [ ] No `# noqa: S608` in `app/db.py`.
- [ ] `README.md` documents `NOTES_DB_PATH`.
- [ ] All Check commands pass; coverage ≥ 90%.

## Verification
```sh
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
.venv/bin/python -m mypy
.venv/bin/python -m pytest -q tests/test_db.py tests/test_main.py
.venv/bin/python -m pytest -q --cov=app --cov-report=term-missing --cov-fail-under=90
.venv/bin/python -c "from fastapi import FastAPI; from app.main import app, create_app; assert isinstance(app, FastAPI) and callable(create_app)"
grep -q "NOTES_DB_PATH" README.md
```
All commands exit 0. `tests/test_db.py` contains at least 8 passing tests, and importing `app.main` doesn't touch the filesystem.

## Risks and notes
- The two-thread test could become flaky if the busy timeout is missing. It is there to prove the `BEGIN IMMEDIATE` design, so don't skip it.
- Keep `init_db` synchronous. Calling it from the async lifespan at startup is acceptable because nothing else is being served yet.
</br>
