---
id: T-005
title: Expose partial note updates
status: pending
phase: 2
depends_on: [T-003]
size: M
risk: medium
tests: required
type: feat
---
## Goal

`PATCH /notes/{note_id}` updates only the fields provided (title, body or tags), with the same validation as create. `tags` replaces the whole set. Users can then fix notes and retag them.

## Context

- Read `AGENTS.md` and `docs/plan/03-decisions/ADR-004-notes-http-contract.md` (PATCH semantics).
- `app/schemas.py` (new, from T-003) has `Title`, `Body` and `TagList`. `app/repository.py` (new, from T-003) has `_set_note_tags` and `get_note`. `app/routes.py` (new, from T-003) has the router.
- Semantics:
  - An explicit `null` for any field returns 422. Use a `@model_validator(mode="before")` that rejects `None` values.
  - `{}` returns 200 with the note unchanged, including `updated_at`.
  - Any provided field sets `updated_at = now(UTC)`, and `created_at` never changes.
  - `tags: []` clears the tags.
  - Unknown fields return 422.
- Use `data.model_fields_set` to find the provided fields. Build `SET` clauses from a fixed column whitelist in code, with values passed as `?` parameters.

## Scope

In:
- `app/schemas.py` (new)
- `app/repository.py` (new)
- `app/routes.py` (new)
- `tests/test_notes_update.py` (new)
- `README.md`

Out:
- The schema DDL in `app/db.py` (new).
- `tests/conftest.py` (new).
- The behavior of the other endpoints.
- `pyproject.toml`.
- CI files.

## Steps

1. Add `NoteUpdate` to `app/schemas.py` (new): `title: Title | None = None`, `body: Body | None = None`, `tags: TagList | None = None`, with `extra="forbid"` and the null-rejecting before-validator.
2. Add `update_note(conn, note_id: int, data: NoteUpdate) -> NoteOut | None` to `app/repository.py` (new):
   - return `None` if the note is missing
   - if no fields were set, return the current note
   - otherwise, inside `with conn:`, update the provided columns plus `updated_at`, and replace the tags when `tags` was provided
3. Add `PATCH "/{note_id}"` to `app/routes.py` (new). It returns `NoteOut`, or 404 `{"detail": "Note not found"}`.
4. `tests/test_notes_update.py` (new):
   - A title-only update changes the title but not the body or tags.
   - A body-only update works.
   - Tags `["B", "a", "b"]` replace the set with `["a", "b"]`.
   - `tags: []` clears the tags.
   - `{}` returns 200 with an identical payload.
   - `created_at` is unchanged and `updated_at >= ` the previous `updated_at`.
   - `GET` after `PATCH` returns the updated note.
   - `{"title": null}` returns 422.
   - `{"title": "  "}` returns 422.
   - `{"colour": "red"}` returns 422.
   - 21 tags return 422.
   - `PATCH /notes/999` returns 404.
   - `PATCH /notes/abc` returns 422.
5. Document `PATCH /notes/{note_id}` in the README, including the null and empty-object behavior.

## Acceptance criteria

- [ ] `PATCH` changes only the provided fields, and `tags` replaces the set, with normalization as on create.
- [ ] An explicit `null`, a blank title, an unknown field or too many tags returns 422. An unknown id returns 404.
- [ ] `{}` returns 200 without changing `updated_at`. `created_at` never changes.
- [ ] SQL `SET` clauses use only column names hard-coded in the repository, and values are `?` parameters.
- [ ] Every case in Steps item 4 is in `tests/test_notes_update.py` (new) and passes.
- [ ] Existing create and fetch tests still pass.
- [ ] `README.md` documents `PATCH`.

## Verification

```sh
.venv/bin/python -m pytest -q tests/test_notes_update.py tests/test_notes_create.py
.venv/bin/python -m ruff format --check .
grep -q 'def update_note' app/repository.py
grep -q 'class NoteUpdate' app/schemas.py
grep -q 'PATCH /notes' README.md
NOTES_DB_PATH=/tmp/notes-t005-$$.db .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8768 &
trap 'kill $!' EXIT
sleep 2
curl -sf -o /dev/null -X POST http://127.0.0.1:8768/notes -H 'Content-Type: application/json' -d '{"title":"draft","tags":["a","b"]}'
curl -sf -X PATCH http://127.0.0.1:8768/notes/1 -H 'Content-Type: application/json' -d '{"title":"renamed"}' | grep -qF '"tags":["a","b"]'
curl -sf http://127.0.0.1:8768/notes/1 | grep -qF '"title":"renamed"'
curl -sf -X PATCH http://127.0.0.1:8768/notes/1 -H 'Content-Type: application/json' -d '{"tags":[]}' | grep -qF '"tags":[]'
curl -s -o /dev/null -w '%{http_code}' -X PATCH http://127.0.0.1:8768/notes/1 -H 'Content-Type: application/json' -d '{"title":null}' | grep -qx 422
curl -s -o /dev/null -w '%{http_code}' -X PATCH http://127.0.0.1:8768/notes/999 -H 'Content-Type: application/json' -d '{"title":"x"}' | grep -qx 404
```

Expected: the tests pass. On the live server, a title-only PATCH keeps the tags, the new title is persisted, `tags: []` clears the tags, `null` returns 422 and an unknown id returns 404.

## Risks and notes

- Test timestamps compare with `>=`, because consecutive calls can in theory share a microsecond.
- This task edits the same files as T-004 and T-006, so run them one at a time.

## Log
