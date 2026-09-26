---
id: T-006
title: Implement DELETE /notes/{note_id} with cascading tag removal
status: pending
phase: 2
depends_on: [T-003]
size: S
risk: low
---
## Goal
When this is done, clients can permanently delete a note, its tags are removed with it, and IDs are never reused. This completes the first deliverable's CRUD.

## Context
- Suggested agent: backend.
- Read first: AGENTS.md; `docs/plan/01-prd.md` (FR-5); ADR-002 (foreign keys and cascade); ADR-004; `app/repository.py`, `app/notes.py`, `app/db.py`, `tests/conftest.py`.
- **Cascade:** it depends on `PRAGMA foreign_keys = ON`, which `connect()` sets (T-002). Don't delete tags by hand; the test proves the cascade works.
- **Empty 204:** return `Response(status_code=204)`, or declare `status_code=204` with a `None` return, so the response body is empty.

## Scope
In:
- `app/repository.py`: `delete_note(conn, note_id) -> bool`
- `app/notes.py`: `DELETE /notes/{note_id}`
- `tests/test_notes_delete.py` (new)
- `README.md`: API section

Out: soft delete, bulk delete.

## Steps
1. `delete_note`: inside `with conn:`, run `DELETE FROM notes WHERE id = ?` and return `rowcount == 1`.
2. Route: a sync `def` with `DELETE "/{note_id}"` and `status_code=204`; raise 404 when `delete_note` returns `False`.
3. Tests; README.

## Acceptance criteria
- [ ] `DELETE /notes/{id}` on an existing note returns 204 with an empty body.
- [ ] Afterwards, `GET /notes/{id}` returns 404, and a second `DELETE` returns 404 `{"detail": "Note not found"}`.
- [ ] Direct SQL (`db_conn` fixture) shows zero `note_tags` rows for the deleted note, while another note's tags are untouched.
- [ ] IDs aren't reused: create notes 1 and 2, delete 2, create another; the new note's ID is 3.
- [ ] `DELETE /notes/abc` returns 422.
- [ ] `README.md` documents DELETE.
- [ ] All Check commands pass; coverage ≥ 90%.

## Verification
```sh
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
.venv/bin/python -m mypy
.venv/bin/python -m pytest -q tests/test_notes_delete.py
.venv/bin/python -m pytest -q --cov=app --cov-report=term-missing --cov-fail-under=90
.venv/bin/python -c "from app.main import app; assert 'delete' in app.openapi()['paths']['/notes/{note_id}']"
grep -q "DELETE /notes" README.md
```
All commands exit 0.

## Risks and notes
- Deletion is permanent. Backups (T-008) are the only way to recover.
</br>
