---
id: T-007
title: Add end-to-end lifecycle test and operations runbook
status: pending
phase: 2
depends_on: [T-004, T-005, T-006]
size: S
risk: low
tests: required
type: test
---
## Goal

One test exercises the full note lifecycle across all endpoints on a single database, including a restart. The README gets an Operations section, so an engineer can run and back up the service on a Linux server. This proves the deliverable end to end.

## Context

- Read `AGENTS.md` and `docs/plan/02-architecture.md` (Cross-cutting, Risks and debt).
- The endpoints come from T-003 to T-006 in `app/routes.py` (new). The fixtures `client` and `db_path` are in `tests/conftest.py` (new). `create_app` is in `app/main.py`.
- Operational facts to document:
  - one uvicorn worker per database file
  - WAL mode creates `-wal` and `-shm` sidecar files next to the database
  - the database directory must be writable by the service user
  - `NOTES_DB_PATH` should be absolute on servers
  - there is no auth, so bind to an internal interface only
  - there is no migration tool (schema version is tracked in `PRAGMA user_version`)

## Scope

In:
- `tests/test_notes_e2e.py` (new)
- `README.md`

Out:
- All `app/` code. If the lifecycle test exposes a bug, record it in the Log and don't fix it here.
- `tests/conftest.py` (new).
- `pyproject.toml`.
- CI files, and deployment files such as systemd units.

## Steps

1. `tests/test_notes_e2e.py` (new), `test_note_lifecycle`:
   1. Create note A with tags `["ops", "release"]` and note B with tags `["ops"]`.
   2. `GET /notes?tag=ops` returns total 2 with B first.
   3. `PATCH` A with `tags=["archive"]`.
   4. `GET /notes?tag=release` returns total 0, and `?tag=archive` returns A.
   5. `DELETE` B, and `GET /notes` returns total 1.
   6. Open a new `TestClient(create_app(db_path=str(db_path)))` context on the same `db_path`. `GET /notes/{A}` returns A with the `archive` tag.
2. Add `test_fresh_database_is_empty` (it uses `client` and asserts `total == 0`) to prove test isolation.
3. Add a `## Operations` section to `README.md`:
   - an example server command: `NOTES_DB_PATH=/var/lib/notes/notes.db .venv/bin/python -m uvicorn app.main:app --host <internal-ip> --port 8000 --workers 1`
   - the single-worker guidance
   - the WAL sidecar files
   - backup with Python's `sqlite3` backup API or the `sqlite3` CLI `.backup` command, not a plain file copy while the service runs
   - there is no auth, so keep the service on an internal network
   - the schema is created at startup and there is no migration tool

## Acceptance criteria

- [ ] `tests/test_notes_e2e.py` (new) contains the lifecycle test and the isolation test, and both pass.
- [ ] The lifecycle test covers create, filtered list, update, delete and a read after restart on the same database file.
- [ ] `README.md` has an `## Operations` section that covers `NOTES_DB_PATH`, single-worker uvicorn, WAL sidecar files, backups, the internal-network-only exposure and the lack of migrations.
- [ ] No files outside Scope changed.

## Verification

```sh
.venv/bin/python -m pytest -q tests/test_notes_e2e.py
.venv/bin/python -m ruff format --check .
grep -q '## Operations' README.md
grep -q 'NOTES_DB_PATH' README.md
grep -qi 'backup' README.md
grep -qi 'workers 1' README.md
grep -qi 'wal' README.md
test ! -e .github
```

Expected: both tests pass, the format check is clean, and the README has the required operations content.

## Risks and notes

- If the lifecycle test fails because of an endpoint bug, this task cannot fix `app/` code. Record the bug in the Log so a fix task can be added.

## Log
