---
id: T-006
title: Expose note deletion
status: pending
phase: 2
depends_on: [T-003]
size: S
risk: low
tests: required
type: feat
---
## Goal

`DELETE /notes/{note_id}` removes a note and its tag links, and returns 204, or 404 if the note does not exist. This completes CRUD.

## Context

- Read `AGENTS.md` and `docs/plan/03-decisions/ADR-004-notes-http-contract.md`.
- `app/repository.py` (new, from T-003) and `app/routes.py` (new, from T-003).
- `note_tags` rows cascade through `ON DELETE CASCADE`, which only works because `connect()` in `app/db.py` (new) enables `PRAGMA foreign_keys`.
- For a 204 response, declare `status_code=204` and return `Response(status_code=204)`, so no body is sent.
- Tags that no note uses any more stay in `tags` by design (ADR-003).

## Scope

In:
- `app/repository.py` (new)
- `app/routes.py` (new)
- `tests/test_notes_delete.py` (new)
- `README.md`

Out:
- The schema DDL in `app/db.py` (new).
- `app/schemas.py` (new).
- `tests/conftest.py` (new).
- The behavior of the other endpoints.
- CI files.

## Steps

1. Add `delete_note(conn, note_id: int) -> bool` to `app/repository.py` (new). It runs `DELETE FROM notes WHERE id = ?` inside `with conn:` and returns `cursor.rowcount > 0`.
2. Add `DELETE "/{note_id}"` to `app/routes.py` (new). It returns 204, or 404 `{"detail": "Note not found"}`.
3. `tests/test_notes_delete.py` (new):
   - Deleting an existing note returns 204 with an empty body.
   - `GET` on the deleted note returns 404.
   - A second `DELETE` returns 404.
   - `DELETE /notes/999` returns 404.
   - `DELETE /notes/abc` returns 422.
   - Deleting one note leaves other notes intact.
   - After deleting a tagged note, `SELECT COUNT(*) FROM note_tags WHERE note_id = ?` is 0. Check this through `app.db.connect(str(db_path))` with the `db_path` fixture.
   - A new note created after a delete gets a new id, so ids are not reused.
4. Document `DELETE /notes/{note_id}` in the README.

## Acceptance criteria

- [ ] `DELETE` returns 204 with no body for an existing note, and 404 `{"detail": "Note not found"}` for a missing one.
- [ ] The note's `note_tags` rows are gone after the delete, and other notes are unaffected.
- [ ] Ids are not reused after a delete.
- [ ] Every case in Steps item 3 is in `tests/test_notes_delete.py` (new) and passes.
- [ ] `README.md` documents `DELETE`.

## Verification

```sh
.venv/bin/python -m pytest -q tests/test_notes_delete.py tests/test_notes_create.py
.venv/bin/python -m ruff format --check .
grep -q 'def delete_note' app/repository.py
grep -q 'DELETE /notes' README.md
NOTES_DB_PATH=/tmp/notes-t006-$$.db .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8769 &
trap 'kill $!' EXIT
sleep 2
curl -sf -o /dev/null -X POST http://127.0.0.1:8769/notes -H 'Content-Type: application/json' -d '{"title":"temp","tags":["x"]}'
curl -s -o /dev/null -w '%{http_code}' -X DELETE http://127.0.0.1:8769/notes/1 | grep -qx 204
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8769/notes/1 | grep -qx 404
curl -s -o /dev/null -w '%{http_code}' -X DELETE http://127.0.0.1:8769/notes/1 | grep -qx 404
```

Expected: the tests pass. On the live server, the first delete returns 204, then both `GET` and a repeated `DELETE` return 404.

## Risks and notes

- This task edits the same files as T-004 and T-005, so run them one at a time.

## Log
