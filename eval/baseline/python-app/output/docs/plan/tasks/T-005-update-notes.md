---
id: T-005
title: Implement PATCH /notes/{note_id} for partial updates including tag replacement
status: pending
phase: 2
depends_on: [T-003]
size: M
risk: low
---
## Goal
When this is done, clients can change a note's title, body and/or tags without resending the whole note, and the change is atomic. This completes the "update" part of the first deliverable.

## Context
- Suggested agent: backend.
- Read first: AGENTS.md; `docs/plan/01-prd.md` (FR-4, the validation table); ADR-004; `app/schemas.py`, `app/repository.py` (`_replace_tags`), `app/notes.py`, `tests/conftest.py`.
- **Validation:**
  - Reuse `Title`, `Body` and `Tags` from `schemas.py`.
  - Use `model_fields_set` to tell "field not sent" apart from "field sent as null". Null is rejected.
- **Static SQL:** since `null` is never allowed, `UPDATE notes SET title = COALESCE(?, title), body = COALESCE(?, body), updated_at = ? WHERE id = ?` works, and `S608` stays clean.
- **Transaction:** run the update and the tag replacement in one `with conn:` block.

## Scope
In:
- `app/schemas.py`: `NoteUpdate`
- `app/repository.py`: `update_note`
- `app/notes.py`: `PATCH /notes/{note_id}`
- `tests/test_notes_update.py` (new)
- `README.md`: API section

Out: PUT, ETag/If-Match, changing `created_at`.

## Steps
1. `NoteUpdate`: `extra="forbid"`; `title: Title | None = None`, `body: Body | None = None`, `tags: Tags | None = None`. Add `model_validator(mode="after")` that:
   - rejects the model if `model_fields_set` is empty;
   - rejects any field that was sent with the value `None`.
2. `update_note(conn, note_id, changes: NoteUpdate) -> Note | None`, all inside one `with conn:`:
   - Run the UPDATE. If `rowcount == 0`, return `None`.
   - If `tags` is in `model_fields_set`, call `_replace_tags`.
   - Return `get_note(...)`.
3. Route: a sync `def` with `PATCH "/{note_id}"` returning `Note`; raise 404 on `None`.
4. Tests; README.

## Acceptance criteria
- [ ] `PATCH {"title": "New"}` returns 200. The title is updated; body and tags are unchanged; `created_at` is unchanged; `updated_at` ≥ its previous value.
- [ ] `PATCH {"body": "text"}` changes only `body` (and `updated_at`).
- [ ] `PATCH {"tags": ["B", "a"]}` returns tags `["a", "b"]`. The old tags are gone, both from `GET` and from the `note_tags` rows (checked with direct SQL).
- [ ] `PATCH {"tags": []}` clears all tags.
- [ ] Each of these returns 422: `PATCH {}`; `{"title": null}`; `{"body": null}`; `{"tags": null}`; an unknown field; a title of `"   "` or of 201 chars; a body of 10,001 chars; tag `"bad tag"`; 21 distinct tags.
- [ ] `PATCH /notes/999999` with a valid body returns 404 `{"detail": "Note not found"}`.
- [ ] **Atomicity:**
  - The test monkeypatches `app.repository._replace_tags` to raise `sqlite3.IntegrityError`.
  - It uses `TestClient(app, raise_server_exceptions=False)` and sends `PATCH {"title": "Changed", "tags": ["x"]}`.
  - The PATCH returns 500. A follow-up GET shows the original title and tags.
- [ ] The UPDATE SQL is static; no new `# noqa: S608`.
- [ ] `README.md` documents PATCH semantics (partial update; `tags` replaces the set; `null` rejected).
- [ ] All Check commands pass; coverage ≥ 90%.

## Verification
```sh
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
.venv/bin/python -m mypy
.venv/bin/python -m pytest -q tests/test_notes_update.py
.venv/bin/python -m pytest -q --cov=app --cov-report=term-missing --cov-fail-under=90
.venv/bin/python -c "from app.main import app; assert 'patch' in app.openapi()['paths']['/notes/{note_id}']"
grep -q "PATCH /notes" README.md
```
All commands exit 0, and the atomicity test passes.

## Risks and notes
- Two quick PATCHes can produce identical `updated_at` values at microsecond resolution. That's why the tests assert `>=`, not `>`.
- The last write wins (ADR-004). Conflict detection is deferred.
</br>
