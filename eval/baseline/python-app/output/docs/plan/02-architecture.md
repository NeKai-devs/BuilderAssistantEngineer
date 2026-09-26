# Architecture

## Current state (evidence)
| Area | Evidence | Observation |
| --- | --- | --- |
| App | `app/main.py:1-3` | One module-level `FastAPI()` instance. No factory, no configuration, no lifespan. |
| Routes | `app/main.py:6-8` | `GET /health` returns `{"ok": True}`. No return type annotation. |
| Package | `app/__init__.py` (empty) | A plain package. |
| Tests | `tests/test_main.py:1-2` | `def test_health(): assert True`. The app is never imported, so the real test coverage is zero. |
| Runtime deps | `pyproject.toml:4` | Only `fastapi>=0.110`. No ASGI server, so the service can't be started from declared dependencies. |
| Dev deps | `pyproject.toml:6-7` | `pytest>=8` and `ruff>=0.5`. No `httpx`, which `fastapi.testclient.TestClient` requires. |
| Python version | `pyproject.toml:1-4` | No `requires-python`, even though 3.12 is a hard requirement. |
| Packaging | `pyproject.toml` | No `[build-system]` and no package-discovery config. |
| Lint | `pyproject.toml:9-10` | ruff with only `line-length = 100` (default rule set). |
| Format / typecheck / CI | repo tree; no `.github/` | All absent. |
| Persistence / config / logging | repo tree | None. |
| Git | `.git/config:1-5`; commit `ad434c4` | No remote. One commit ("chore: initial state"). `.gitignore` is untracked. |
| Ignore rules | `.gitignore:1-2` | Only `.bae/runs/` and `.bae/tmp/`. No venv, cache or DB entries. |
| Docs | `README.md:1-3` | One line: "FastAPI service fixture." |

There is no problematic legacy code. The gaps are missing scaffolding: packaging, tests, persistence and operations.

## Target state

### Components
```text
            HTTP (internal network)
                    |
        uvicorn (1 worker, systemd)
                    |
  app.main:create_app(settings) --lifespan--> db.init_db(path)  [migrations, WAL]
                    |
     /health (main.py)      /notes router (notes.py)
                    |               |
                    |      schemas.py (Pydantic v2: validation, tag normalization)
                    |               |
                    +--> db.get_conn (per-request sqlite3.Connection)
                                    |
                            repository.py (all note SQL, one transaction per write)
                                    |
                         SQLite file ($NOTES_DB_PATH)
```

### Module responsibilities
| Module | Responsibility | Created by |
| --- | --- | --- |
| `app/config.py` | `Settings` frozen dataclass; `from_env()` reads `NOTES_DB_PATH` and `NOTES_LOG_LEVEL` | T-002, T-007 |
| `app/db.py` | `connect()` (pragmas), `init_db()` (versioned migrations), `get_conn` dependency and `Conn` alias | T-002 |
| `app/main.py` | `create_app()`, lifespan, `/health`, router wiring, logging setup; module-level `app` | T-001, T-002, T-003, T-007 |
| `app/schemas.py` | Request and response models, `normalize_tag()`, `ListParams` | T-003 to T-005 |
| `app/repository.py` | `create_note`, `get_note`, `list_notes`, `update_note`, `delete_note` | T-003 to T-006 |
| `app/notes.py` | `/notes` APIRouter | T-003 to T-006 |

### Data model (schema v1)
```sql
CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,   -- AUTOINCREMENT: deleted ids are never reused
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,               -- ISO 8601 UTC, microseconds, fixed format
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_notes_updated_at ON notes (updated_at DESC, id DESC);
CREATE TABLE note_tags (
    note_id INTEGER NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    tag TEXT NOT NULL,                      -- normalized: lowercase [a-z0-9_-], 1-32 chars
    PRIMARY KEY (note_id, tag)
) WITHOUT ROWID;
CREATE INDEX idx_note_tags_tag ON note_tags (tag, note_id);
```
Length limits are enforced in Pydantic, not in SQL `CHECK` constraints. SQLite cannot alter a constraint without rebuilding the table (ADR-002).

### API
| Method | Path | Success | Errors |
| --- | --- | --- | --- |
| GET | `/health` | 200 `{"ok": true}` | 503 `{"ok": false}` (T-007) |
| POST | `/notes` | 201 Note + `Location` | 422 |
| GET | `/notes` | 200 `{"items","total","limit","offset"}` | 422 |
| GET | `/notes/{note_id}` | 200 Note | 404, 422 |
| PATCH | `/notes/{note_id}` | 200 Note | 404, 422 |
| DELETE | `/notes/{note_id}` | 204 | 404, 422 |

### Cross-cutting concerns
- **Concurrency:**
  - Endpoints are sync `def` and run in FastAPI's threadpool.
  - Each request gets its own connection, opened with `check_same_thread=False` because dependency setup and teardown can run on different threads.
  - WAL mode plus a 5 s busy timeout let reads run during a write.
- **Migrations:**
  - An ordered list of statements is applied inside `BEGIN IMMEDIATE`, with `user_version` read inside the transaction, so two processes starting together are safe.
  - `executescript()` is not used, because it commits implicitly.
- **Errors:** FastAPI's default 422 and `HTTPException(404, "Note not found")`. Unexpected `sqlite3` errors become 500 and are logged by uvicorn.
- **Security:**
  - No auth, so the network boundary is the control; the systemd unit binds to 127.0.0.1.
  - All SQL is parameterized (ruff `S608`), and input sizes are bounded.
- **Observability:** `/health` with a DB query; one startup log line (DB path and schema version); uvicorn access logs; no note content in logs.
- **Testing:** `TestClient` tests with a temporary DB per test, direct-SQL assertions where storage matters, and a live smoke script (T-008).

## Migration path
1. **T-001:** make the project installable and verifiable (packaging, deps, ruff format, mypy, a real health test, CI). No behavior change.
2. **T-002:** introduce `create_app`, `Settings`, `db.py` and schema v1. `/health` stays the same.
3. **T-003:** add schemas, repository and router; POST and GET by id.
4. **T-004 to T-006:** list, PATCH and DELETE, following the same pattern.
5. **T-007:** a DB-aware `/health` (adds 503 when the DB is broken; the healthy response is unchanged) and logging configuration.
6. **T-008:** systemd unit, ops guide, live smoke test in CI.

Each step leaves `uvicorn app.main:app` runnable and all checks green. Future schema changes add a new entry to `MIGRATIONS` in `app/db.py`; existing migrations are never edited.
