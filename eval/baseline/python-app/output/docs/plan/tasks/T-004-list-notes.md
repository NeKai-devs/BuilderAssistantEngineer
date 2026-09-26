---
id: T-004
title: Implement GET /notes with pagination, stable ordering and tag filtering
status: pending
phase: 2
depends_on: [T-003]
size: M
risk: medium
---
## Goal
When this is done, clients can list notes with the most recently updated first, page through them, and filter by one or more tags (AND). This completes the "list" part of the first deliverable.

## Context
- Suggested agent: backend.
- Read first: AGENTS.md; `docs/plan/01-prd.md` (FR-3); ADR-003; ADR-004; `app/schemas.py`, `app/repository.py`, `app/notes.py`, `tests/conftest.py`.
- **Query parsing:** use a FastAPI query-parameter model (FastAPI ≥ 0.115), `params: Annotated[ListParams, Query()]`, so invalid query values produce FastAPI's standard 422 body.
- **Gotchas:**
  - Normalize, then deduplicate, the filter tags before building SQL. `HAVING COUNT(*) = ?` must use the number of distinct tags; `?tag=work&tag=WORK` counts as one tag.
  - The `IN (?, ?, …)` list is built only from generated `?` placeholders. Mark that line `# noqa: S608  # only generated '?' placeholders are interpolated`. Never interpolate values.
  - Avoid N+1 queries: fetch tags for the whole page in one query (`WHERE note_id IN (...)`).
  - Order by `updated_at DESC, id DESC`. Timestamps use one fixed ISO format, so sorting the strings sorts by time.

## Scope
In:
- `app/schemas.py`: `ListParams`, `NoteList`
- `app/repository.py`: `list_notes`
- `app/notes.py`: `GET /notes`
- `tests/test_notes_list.py` (new)
- `README.md`: API section

Out: sort options, search, `GET /tags`, cursor pagination.

## Steps
1. `ListParams`: `limit: int = Field(50, ge=1, le=200)`, `offset: int = Field(0, ge=0)`, `tag: list[Tag] = Field(default_factory=list)`. `NoteList`: `items: list[Note]`, `total: int`, `limit: int`, `offset: int`.
2. `list_notes(conn, *, limit: int, offset: int, tags: list[str]) -> tuple[list[Note], int]`:
   - Optional filter: `id IN (SELECT note_id FROM note_tags WHERE tag IN (<placeholders>) GROUP BY note_id HAVING COUNT(*) = ?)`.
   - One `COUNT(*)` query, one page query with `ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`, and one tags query for the page's IDs.
3. Route `GET ""` returns `NoteList`.
4. Tests; README.

## Acceptance criteria
- [ ] With an empty DB, `GET /notes` returns 200 `{"items": [], "total": 0, "limit": 50, "offset": 0}`.
- [ ] Notes A, B and C created in that order are listed as C, B, A.
- [ ] After A's `updated_at` is set to a later timestamp with direct SQL (`db_conn` fixture), A is listed first.
- [ ] Two notes with identical `updated_at`: the higher `id` comes first.
- [ ] With 5 notes, `?limit=2&offset=2` returns the 3rd and 4th newest, with `total` 5, `limit` 2, `offset` 2. `?offset=10` returns `items` `[]` and `total` 5.
- [ ] `?limit=0`, `?limit=201`, `?offset=-1` and `?limit=abc` each return 422.
- [ ] `?tag=work` returns only notes tagged `work`. `?tag=work&tag=urgent` returns only notes with both tags. `total` reflects the filter.
- [ ] `?tag=WORK` behaves like `?tag=work`, and `?tag=work&tag=WORK` behaves like `?tag=work`.
- [ ] `?tag=bad%20tag` and `?tag=` each return 422.
- [ ] Filtered items include their full sorted tag list: a note tagged `urgent, work`, filtered by `work`, returns `["urgent", "work"]`.
- [ ] A repository-level test using `sqlite3.Connection.set_trace_callback` shows that listing a page of 20 notes runs at most 3 SELECT statements.
- [ ] `README.md` documents the `GET /notes` parameters and response shape.
- [ ] All Check commands pass; coverage ≥ 90%. The only new `# noqa: S608` is the placeholder line, with its comment.

## Verification
```sh
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
.venv/bin/python -m mypy
.venv/bin/python -m pytest -q tests/test_notes_list.py
.venv/bin/python -m pytest -q --cov=app --cov-report=term-missing --cov-fail-under=90
.venv/bin/python -c "from app.main import app; p = app.openapi()['paths']; assert 'get' in p['/notes']"
grep -q "GET /notes" README.md
```
All commands exit 0, and every acceptance criterion maps to at least one test in `tests/test_notes_list.py`.

## Risks and notes
- If a list field inside a query-parameter model doesn't validate items as expected, fall back to separate `Annotated[..., Query()]` parameters. Validate the tags with the same `Tag` type so errors are still standard 422s, and record the deviation here.
- `COUNT` and the page query run as separate statements, so a concurrent write can make `total` briefly inconsistent with `items`. This is acceptable for internal use.
</br>
