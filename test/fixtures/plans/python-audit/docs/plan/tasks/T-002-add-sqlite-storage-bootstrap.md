---
id: T-002
title: Add SQLite storage bootstrap with per-test databases
status: pending
phase: 1
depends_on: [T-001]
size: M
risk: medium
tests: required
type: feat
---
## Goal

The app gets an application factory that reads the SQLite path from `NOTES_DB_PATH`, creates the schema at startup and gives each request its own connection. Tests get fixtures that give every test its own database file. This is the storage foundation all note endpoints build on.

## Context

- Read `AGENTS.md`, `docs/plan/03-decisions/ADR-002-sqlite-stdlib-persistence.md` and `docs/plan/03-decisions/ADR-005-app-factory-and-config.md`.
- `app/main.py:1-8`: the module-level `app = FastAPI()` and `GET /health`. Keep the health response and keep a module-level `app`.
- `.gitignore:1-6`: database files are not ignored yet.
- The full schema DDL is in `docs/plan/02-architecture.md` under "Data model". Use it exactly.
- Gotchas:
  - Use the `lifespan` parameter, not `on_event`.
  - `TestClient` only runs the lifespan when used as a context manager.
  - FastAPI may run a sync dependency and the endpoint on different threads, so pass `check_same_thread=False`.
  - `PRAGMA foreign_keys` is per connection, so set it in `connect()`.

## Scope

In:
- `app/config.py` (new)
- `app/db.py` (new)
- `app/main.py`
- `tests/conftest.py` (new)
- `tests/test_db.py` (new)
- `.gitignore`
- `README.md`

Out:
- `pyproject.toml` (no new dependencies).
- `tests/test_main.py`.
- Any `/notes` endpoint.
- CI files.

## Steps

1. `app/config.py` (new):
   - `DB_PATH_ENV = "NOTES_DB_PATH"` and `DEFAULT_DB_PATH = "notes.db"`
   - `@dataclass(frozen=True) class Settings: db_path: str`
   - `def load_settings() -> Settings` reads the environment when called, not at import
2. `app/db.py` (new):
   - `SCHEMA` holds the DDL.
   - `connect(db_path: str) -> sqlite3.Connection` passes `check_same_thread=False`, sets `row_factory = sqlite3.Row` and runs `PRAGMA foreign_keys = ON`.
   - `init_db(db_path: str) -> None`:
     - `Path(db_path).parent.mkdir(parents=True, exist_ok=True)`
     - connect
     - `PRAGMA journal_mode=WAL`
     - `executescript(SCHEMA)`
     - `PRAGMA user_version = 1`
     - close
   - `get_connection(request: Request) -> Iterator[sqlite3.Connection]` yields `connect(request.app.state.db_path)` and closes it in `finally`.
   - `DbConn = Annotated[sqlite3.Connection, Depends(get_connection)]`.
3. `app/main.py`:
   - add `create_app(db_path: str | None = None) -> FastAPI`
   - resolve the path, set `app.state.db_path` and attach a lifespan that calls `init_db` and logs `"SQLite database ready at %s"`
   - register `GET /health` unchanged
   - end the module with `app = create_app()`
4. `tests/conftest.py` (new):
   - fixture `db_path(tmp_path: Path) -> Path` returns `tmp_path / "notes.db"`
   - fixture `client(db_path: Path) -> Iterator[TestClient]` yields from inside `with TestClient(create_app(db_path=str(db_path))) as test_client:`
5. `tests/test_db.py` (new) covers:
   - the tables `notes`, `tags` and `note_tags` exist
   - `init_db` is idempotent (call it twice)
   - `connect()` reports `PRAGMA foreign_keys` = 1
   - `PRAGMA user_version` = 1
   - deleting a note cascades to `note_tags`
   - `load_settings()` honours `NOTES_DB_PATH` (use `monkeypatch`) and defaults to notes.db
   - `create_app(db_path=p)` does not create `p` until the `TestClient` context starts, and the file exists after startup
   - `create_app()` with `NOTES_DB_PATH` set creates the database at that path on startup
   - `GET /health` still returns `{"ok": True}` through the `client` fixture
6. Add `*.db`, `*.db-wal` and `*.db-shm` to `.gitignore`.
7. Add "Configuration" and "Running" sections to `README.md`: `NOTES_DB_PATH` with its default, and the uvicorn command from `AGENTS.md`.

## Acceptance criteria

- [ ] `load_settings()` in `app/config.py` returns the `NOTES_DB_PATH` value, or notes.db when it is unset.
- [ ] `app/db.py`:
  - [ ] `connect` enables foreign keys, uses `sqlite3.Row` and passes `check_same_thread=False`
  - [ ] `init_db` creates the three tables and the `idx_note_tags_tag_id` index, sets WAL and `user_version = 1`, and is idempotent
  - [ ] `get_connection` yields and closes a per-request connection
- [ ] `app/main.py`:
  - [ ] exposes `create_app(db_path: str | None = None)` and a module-level `app`
  - [ ] the schema is created only in the lifespan, so importing the module creates no file
- [ ] `GET /health` still returns 200 `{"ok": true}`.
- [ ] `tests/conftest.py` provides the `db_path` and `client` fixtures, with a fresh file per test.
- [ ] `tests/test_db.py` covers every behavior listed in Steps item 5, and the tests pass.
- [ ] `.gitignore` ignores `*.db`, `*.db-wal` and `*.db-shm`.
- [ ] `README.md` documents `NOTES_DB_PATH` and how to run the server.
- [ ] A uvicorn server started with `NOTES_DB_PATH` answers `/health` and creates the database file.

## Verification

```sh
.venv/bin/python -m pytest -q tests/test_db.py tests/test_main.py
.venv/bin/python -m ruff format --check .
grep -q 'NOTES_DB_PATH' app/config.py
grep -q 'foreign_keys' app/db.py
grep -q 'check_same_thread=False' app/db.py
grep -q 'user_version' app/db.py
grep -q 'def create_app' app/main.py
grep -qF '*.db' .gitignore
grep -q 'NOTES_DB_PATH' README.md
NOTES_DB_PATH=/tmp/notes-t002-$$.db .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765 &
trap 'kill $!' EXIT
sleep 2
curl -sf http://127.0.0.1:8765/health
test -f /tmp/notes-t002-$$.db
```

Expected: all tests pass, the format check is clean, every grep matches, the server answers `/health` with 200, and the database file exists at the configured path.

## Risks and notes

- The smoke check leaves a small database file in /tmp named after the script's process id. This is harmless.
- Port 8765 must be free on the machine running Verification.
- `mypy` strict (a runner gate) checks the fixtures too. Annotate generator fixtures as `Iterator[...]`.

## Log
