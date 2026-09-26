# ADR-002: SQLite through built-in `sqlite3`, one repository module, `user_version` migrations

- Status: accepted
- Date: 2026-09-26

## Context
- The brief requires SQLite. The schema is small (two tables).
- Brownfield evidence: no persistence code exists (`app/`), and the only runtime dependency is FastAPI (`pyproject.toml:4`).
- FastAPI runs sync endpoints in a threadpool. `sqlite3` connections are thread-bound by default (`check_same_thread=True`).

## Decision
- **Access:** use Python's built-in `sqlite3`.
  - All note SQL lives in `app/repository.py`.
  - Values are always bound with `?`.
  - Each write runs in one `with conn:` transaction.
  - The repository returns Pydantic `Note` models; for a service this size, that coupling is accepted.
- **Connections:** one per request, from a FastAPI generator dependency (`get_conn`).
  - Opened with `check_same_thread=False`, because setup, endpoint and teardown may run on different threadpool threads while the connection is still used by only one request.
  - `row_factory = sqlite3.Row`, `PRAGMA foreign_keys = ON`, busy timeout 5000 ms; closed in `finally`.
- **Journal mode:** `PRAGMA journal_mode = WAL`, set once at startup.
- **Migrations:**
  - `MIGRATIONS` is an ordered list; each entry is a list of SQL statements.
  - At startup `init_db()` switches the connection to autocommit mode (`isolation_level=None`) and runs `BEGIN IMMEDIATE`.
  - It reads `PRAGMA user_version` inside the transaction, runs the pending statements one at a time, sets `user_version`, and commits (rolling back on error).
  - `executescript()` is never used there, because it commits implicitly.
- **Constraints:** length limits are enforced in Pydantic only. SQL enforces `NOT NULL`, primary keys and foreign keys.

## Alternatives considered
- **SQLAlchemy 2.0 + Alembic:** lost. That is two dependencies plus migration tooling for two tables. It would make a later move to Postgres easier, but that isn't a requirement; the repository module keeps such a rewrite local.
- **SQLModel:** lost. It is less mature and couples API schemas to table models, which conflicts with a distinct create/update/response model set.
- **aiosqlite with async endpoints:** lost. It adds a dependency and async complexity with no throughput need; the threadpool with sync endpoints is enough.
- **A single shared connection:** lost. It would need locking, and it risks cross-request transaction interference.

## Consequences
- No new runtime dependency, and the SQL is explicit and easy to review.
- Rows are mapped to models by hand in one module.
- Changing a constraint later means a table-rebuild migration, which is why length limits stay out of SQL.
- `:memory:` databases don't work with per-request connections, so tests use files under `tmp_path`.
- Moving to another database later means rewriting `repository.py` and `db.py` only.
