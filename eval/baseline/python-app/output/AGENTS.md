<!-- bae:begin -->
# AGENTS.md: notes API

## Purpose
An internal HTTP API for notes with tags, stored in SQLite. It supports create, list (paginated, filterable by tag), get, update (PATCH) and delete.
Authentication and a web UI are out of scope. Do not add them.

## Current state
This is a brownfield repo. When the plan was written (2026-09-26), it had only `GET /health` (`app/main.py`) and a placeholder test (`tests/test_main.py`).
The plan lives in `docs/plan/`. Modules in the architecture map below appear as their tasks are completed. Check that a file exists before you rely on it.

## Stack
- **Python:** 3.12 is the production target (`requires-python = ">=3.12"`), running on Linux.
- **Web layer:** FastAPI (>= 0.115), Pydantic v2, uvicorn.
- **Database:** SQLite through Python's built-in `sqlite3` module, with no ORM (see ADR-002).
- **Tooling:**
  - ruff for lint and format.
  - mypy in strict mode, on `app/` only.
  - pytest, pytest-cov, and httpx (needed by FastAPI's `TestClient`).
  - CI on GitHub Actions (`.github/workflows/ci.yml`).
- **Packages:** pip plus a venv at `.venv/`. Dependencies are declared in `pyproject.toml`. There is no lockfile.

## Setup
```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
```
Re-run the install after any change to `pyproject.toml`. If `.venv/` is missing, run Setup first.

## Run
```sh
NOTES_DB_PATH=data/notes.db .venv/bin/python -m uvicorn app.main:app --reload --port 8000
```
Configuration comes from environment variables, read by `app/config.py`:
- `NOTES_DB_PATH`: path to the SQLite file. Default `data/notes.db`. The parent directory is created at startup, and the schema is migrated at startup.
- `NOTES_LOG_LEVEL`: one of `DEBUG`, `INFO`, `WARNING`, `ERROR`. Default `INFO`. Available once T-007 is done.

The OpenAPI UI is at `/docs`. The notes endpoints exist once T-003 to T-006 are done.

## Check (all must pass before a task is done)
```sh
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
.venv/bin/python -m mypy
.venv/bin/python -m pytest -q --cov=app --cov-report=term-missing --cov-fail-under=90
```
- Auto-fix: `.venv/bin/python -m ruff format .` and `.venv/bin/python -m ruff check --fix .`
- Single test: `.venv/bin/python -m pytest -q tests/test_notes_list.py -k tag`
- Live end-to-end check (from T-008): `.venv/bin/python scripts/smoke.py`

## Architecture map (target)
```text
app/
  main.py        create_app(settings) factory; lifespan runs migrations; /health; includes routers;
                 module-level `app = create_app()` for uvicorn (must not touch disk at import)
  config.py      Settings (frozen dataclass) + Settings.from_env()
  db.py          connect(), init_db() + migrations (PRAGMA user_version), get_conn dependency, Conn alias
  schemas.py     Pydantic models: NoteCreate, NoteUpdate, Note, NoteList, ListParams; normalize_tag()
  repository.py  the ONLY module with note SQL: create/get/list/update/delete
  notes.py       APIRouter for /notes; thin: validated input -> repository -> response model
tests/
  conftest.py    fixtures: settings(tmp_path), app, client (TestClient as context manager), db_conn
  test_*.py      one file per concern: test_db.py, test_schemas.py, test_notes_create_get.py,
                 test_notes_list.py, test_notes_update.py, test_notes_delete.py, test_main.py
scripts/smoke.py           live end-to-end check against a real uvicorn process (T-008)
deploy/notes-api.service   systemd unit example (T-008)
docs/operations.md         install, run, back up and upgrade on Linux (T-008)
docs/plan/                 plan, ADRs, tasks
```
**Request flow:** HTTP request, then FastAPI/Pydantic validation (`schemas.py`), then a sync route in `notes.py`, then `repository.py` using a per-request connection from `get_conn`, then a Pydantic response.

**Schema v1:**
```sql
notes(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
note_tags(note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE, tag TEXT NOT NULL,
          PRIMARY KEY (note_id, tag)) WITHOUT ROWID
```

## Conventions
- **Endpoints and dependencies:**
  - Endpoints that touch SQLite are sync `def`, never `async def`. `sqlite3` is blocking, and FastAPI runs sync endpoints in a threadpool.
  - Declare dependencies as `Annotated[..., Depends(...)]`. Use the `Conn` alias from `app/db.py` for the connection.
- **SQL:**
  - Note SQL lives only in `app/repository.py`; migrations live in `app/db.py`.
  - Always bind values with `?`. Ruff rule `S608` enforces this. `# noqa: S608` is allowed only where the interpolated text is generated `?` placeholders, with a comment saying so.
  - Each write operation runs in one transaction: wrap all its statements in `with conn:`.
- **Connections:**
  - Open one connection per request through `get_conn`. It uses `check_same_thread=False`, `PRAGMA foreign_keys = ON` and a 5000 ms busy timeout, and is closed in `finally`.
  - Never store a connection on `app.state` or share it between requests.
- **Timestamps:**
  - UTC, generated in Python, stored as ISO 8601 text with microseconds: `datetime.now(UTC).isoformat(timespec="microseconds")`. Always use this one format, because list ordering compares the strings.
  - Never pass `datetime` objects to `sqlite3`: its default datetime adapters are deprecated in Python 3.12.
- **Tags:** normalize only through `schemas.normalize_tag()` (strip, lowercase, match `^[a-z0-9][a-z0-9_-]{0,31}$`). Store them deduplicated and return them sorted.
- **Validation and errors:**
  - Request models use `ConfigDict(extra="forbid")`.
  - Errors use FastAPI's default shapes: 422 `{"detail": [...]}` for validation and 404 `{"detail": "Note not found"}`. Do not invent a custom error envelope.
- **Types and style:**
  - Full type hints in `app/`; mypy strict must pass.
  - ruff format with line length 100; ruff sorts imports.
- **Logging:**
  - `logging.getLogger(__name__)` inside `app/`.
  - Log note IDs, never note titles or bodies.
- **Tests:**
  - Plain pytest functions using the `client` fixture, with a fresh DB file under `tmp_path` for each test.
  - No network, no `sleep`, no shared state.
  - Always use `TestClient` as a context manager so the lifespan (and so the migrations) runs.
- **Commits:** Conventional Commits that include the task ID, e.g. `feat(notes): add PATCH /notes/{note_id} (T-005)`. The repo's first commit follows this style: `chore: initial state`.

## Do
- Read the whole task file and the files listed in its Context before editing.
- Stay inside the task's Scope. Write follow-ups under the task's "Risks and notes" instead of doing them.
- Add or update tests in the same task as the code they cover.
- Update the API section of `README.md` whenever an endpoint's behavior changes.

## Don't
- Don't add authentication, users, a web UI, full-text search, or another database. These are out of scope.
- Don't add a dependency without an ADR in `docs/plan/03-decisions/`.
- Don't call `executescript()` inside a migration transaction. It commits implicitly.
- Don't weaken tests, lint rules, mypy strictness or the coverage floor to get a green run.
- Don't commit `.venv/`, `data/`, `*.db`, `*.db-wal` or `*.db-shm`.
- Don't push, force-push, rewrite history, or use `sudo`.
- Don't mark a task `done` while checks fail or before the reviewer returns PASS.

## Plan and tasks
- **Plan documents:**
  - `docs/plan/00-overview.md`, `01-prd.md`, `02-architecture.md`, `04-roadmap.md`
  - ADRs in `docs/plan/03-decisions/`
  - tasks in `docs/plan/tasks/T-XXX-*.md`
- **Status:** each task's status lives only in its own frontmatter: `pending` → `in_progress` → `done`, or `blocked` with the reason written under "Risks and notes".
- **Next task:** resume any `in_progress` task first. Otherwise take the lowest-ID `pending` task whose `depends_on` tasks are all `done`.
- **Workflow per task:** set `in_progress`, implement, run the task's Verification block plus the Check commands, get a reviewer PASS, set `done`, commit.
- **Agents:** `backend`, `test-engineer`, `platform`, `reviewer`, defined in `.claude/agents/` and `.opencode/agent/`. Each task names its suggested agent under Context.
<!-- bae:end -->
