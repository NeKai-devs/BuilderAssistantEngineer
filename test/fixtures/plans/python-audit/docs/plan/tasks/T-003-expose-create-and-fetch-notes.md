---
id: T-003
title: Expose endpoints to create and fetch tagged notes
status: pending
phase: 1
depends_on: [T-002]
size: M
risk: medium
tests: required
type: feat
---
## Goal

`POST /notes` creates a validated note with normalized tags, stored in SQLite. `GET /notes/{note_id}` returns it, or 404. This is the first vertical slice and the Phase 1 demo: a tagged note survives a server restart.

## Context

- Read `AGENTS.md`, `docs/plan/03-decisions/ADR-003-tag-data-model.md`, `docs/plan/03-decisions/ADR-004-notes-http-contract.md` and `docs/plan/02-architecture.md` (Data model, HTTP contract).
- `app/db.py` (new, from T-002) provides `DbConn`, `connect` and the schema. `tests/conftest.py` (new, from T-002) provides the `client` and `db_path` fixtures.
- `app/main.py`: `create_app` from T-002. Include the new router there.
- Validation rules (FR-6):
  - `Title` is `StringConstraints(strip_whitespace=True, min_length=1, max_length=200)`
  - `Body` is `StringConstraints(max_length=10_000)`, default `""`
  - `Tag` is `StringConstraints(strip_whitespace=True, to_lower=True, min_length=1, max_length=50)`
  - `TagList` allows at most 20 items, is deduplicated, and is sorted after validation (an `AfterValidator`)
  - request models use `ConfigDict(extra="forbid")`
- mypy strict flags values returned from `sqlite3.Row` as `Any`. Build responses with `NoteOut.model_validate({...})` or explicit `int()` and `str()` conversions.

## Scope

In:
- `app/schemas.py` (new)
- `app/repository.py` (new)
- `app/routes.py` (new)
- `app/main.py`
- `tests/test_notes_create.py` (new)
- `README.md`

Out:
- The schema DDL in `app/db.py` (new). If you think it needs changing, stop and explain in the Log.
- `tests/conftest.py` (new) fixtures. Put any helpers inside the test module.
- `pyproject.toml`.
- CI files.

## Steps

1. `app/schemas.py` (new):
   - the types `Title`, `Body`, `Tag` and `TagList`
   - `normalize_tag(value: str) -> str` (strip and lowercase)
   - `NoteCreate(title, body="", tags=[])`
   - `NoteOut(id, title, body, tags: list[str], created_at: datetime, updated_at: datetime)`
2. `app/repository.py` (new):
   - `create_note(conn, data: NoteCreate) -> NoteOut`: insert the note with `datetime.now(UTC).isoformat()` for both timestamps, then `INSERT OR IGNORE INTO tags(name)`, look up the ids and insert `note_tags`, all inside `with conn:`.
   - `get_note(conn, note_id: int) -> NoteOut | None`, with tags loaded via a join and `ORDER BY name`.
   - Keep the tag helpers private (`_set_note_tags` and `_load_tags`) so T-004 and T-005 can reuse them.
3. `app/routes.py` (new):
   - `router = APIRouter(prefix="/notes", tags=["notes"])`
   - `POST ""` with `status_code=201` and `response_model=NoteOut`
   - `GET "/{note_id}"` raises `HTTPException(status_code=404, detail="Note not found")` when the repository returns `None`
   - use `DbConn` for the connection
4. Include the router in `create_app`.
5. `tests/test_notes_create.py` (new), using the `client` and `db_path` fixtures:
   - Create returns 201 with an `id`, the stripped title, `body == ""` by default, `tags == []` by default, and `created_at == updated_at`.
   - Tags `[" Work ", "work", "Ideas"]` come back as `["ideas", "work"]`.
   - `GET` after create returns the identical payload.
   - `GET /notes/999` returns 404 with `{"detail": "Note not found"}`. `GET /notes/abc` returns 422.
   - Each of these returns 422:
     - missing title
     - whitespace-only title
     - a 201-character title
     - a 10,001-character body
     - an empty tag `""`
     - a 51-character tag
     - 21 tags
     - an unknown field `{"title": "x", "colour": "red"}`
     - `tags` given as a string
   - Persistence: create a note with the `client` fixture, then open a second `TestClient(create_app(db_path=str(db_path)))` context on the same `db_path`. `GET` returns the note.
6. Add an "API" section to `README.md` documenting `POST /notes` and `GET /notes/{note_id}` with a curl example and the validation limits, including that tags are lowercased.

## Acceptance criteria

- [ ] `POST /notes` returns 201 and a `NoteOut` with normalized, deduplicated, sorted tags and equal UTC timestamps.
- [ ] `GET /notes/{note_id}` returns 200 with the stored note, 404 `{"detail": "Note not found"}` for an unknown id, and 422 for a non-integer id.
- [ ] Every invalid input listed in Steps item 5 returns 422.
- [ ] A note created through one app instance can be read through a new app instance on the same database file.
- [ ] All SQL is in `app/repository.py` (new) and uses `?` placeholders. `app/routes.py` (new) contains no SQL.
- [ ] `tests/test_notes_create.py` (new) covers every behavior listed in Steps item 5, and the tests pass.
- [ ] `README.md` documents both endpoints.
- [ ] Against a running server, POST and then GET work and an unknown id returns 404.

## Verification

```sh
.venv/bin/python -m pytest -q tests/test_notes_create.py
.venv/bin/python -m ruff format --check .
grep -q 'def create_note' app/repository.py
grep -q 'def get_note' app/repository.py
grep -q 'APIRouter' app/routes.py
grep -q 'include_router' app/main.py
grep -q 'POST /notes' README.md
NOTES_DB_PATH=/tmp/notes-t003-$$.db .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8766 &
trap 'kill $!' EXIT
sleep 2
curl -sf -X POST http://127.0.0.1:8766/notes -H 'Content-Type: application/json' -d '{"title":" hello ","tags":["Demo","demo"]}' | grep -qF '"tags":["demo"]'
curl -sf http://127.0.0.1:8766/notes/1 | grep -qF '"title":"hello"'
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8766/notes/999 | grep -qx 404
curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8766/notes -H 'Content-Type: application/json' -d '{"title":"   "}' | grep -qx 422
```

Expected: the tests pass, the format check is clean, and every grep matches. The live server returns the normalized tags, the stored note, 404 for an unknown id and 422 for a blank title.

## Risks and notes

- The server check assumes `curl` is installed and port 8766 is free.
- The `to_lower` and `strip_whitespace` constraints run before the length checks in pydantic v2. Verify with the 51-character and blank-tag tests.

## Log
