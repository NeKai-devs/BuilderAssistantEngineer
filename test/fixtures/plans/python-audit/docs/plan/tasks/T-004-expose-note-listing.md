---
id: T-004
title: Expose note listing with tag filter and pagination
status: pending
phase: 2
depends_on: [T-003]
size: M
risk: low
tests: required
type: feat
---
## Goal

`GET /notes` returns notes newest first. It can be filtered by one tag and paginated with `limit` and `offset`, and it returns a total count. Users can then find notes without knowing their ids.

## Context

- Read `AGENTS.md` and `docs/plan/03-decisions/ADR-004-notes-http-contract.md` (the listing contract).
- `app/schemas.py` (new, from T-003) has `NoteOut` and `normalize_tag`. `app/repository.py` (new, from T-003) has the tag helpers. `app/routes.py` (new, from T-003) has the `/notes` router.
- The contract:
  - `limit` is an integer from 1 to 100, default 50
  - `offset` is an integer, 0 or more, default 0
  - `tag` is optional, 1 to 50 characters, must contain at least one non-whitespace character (`Query(min_length=1, max_length=50, pattern=r"\S")`), and is normalized with `normalize_tag` before querying
  - results are ordered by `id DESC`
  - the response is `NotePage{items, total, limit, offset}`
- Avoid N+1 queries: load the tags for all note ids on the page in one query with a `?` placeholder per id. Never interpolate values.

## Scope

In:
- `app/schemas.py` (new)
- `app/repository.py` (new)
- `app/routes.py` (new)
- `tests/test_notes_list.py` (new)
- `README.md`

Out:
- The schema DDL in `app/db.py` (new).
- `tests/conftest.py` (new).
- Existing endpoint behavior.
- `pyproject.toml`.
- CI files.

## Steps

1. Add `NotePage(items: list[NoteOut], total: int, limit: int, offset: int)` to `app/schemas.py` (new).
2. Add `list_notes(conn, *, tag: str | None, limit: int, offset: int) -> tuple[list[NoteOut], int]` to `app/repository.py` (new):
   - a count query and a page query that share the same `WHERE`
   - the tag filter is `n.id IN (SELECT nt.note_id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE t.name = ?)`
3. Add `GET ""` to `app/routes.py` (new) with the query parameters above, returning `NotePage`. Make sure `POST ""` and `GET "/{note_id}"` still work.
4. `tests/test_notes_list.py` (new):
   - An empty database returns `{"items": [], "total": 0, "limit": 50, "offset": 0}`.
   - Three notes come back newest first.
   - `?tag=work` returns only notes tagged work. `?tag=%20WORK%20` matches the same notes. `total` reflects the filter.
   - An unknown tag returns 200 with an empty list.
   - With 5 notes: `limit=2&offset=0` returns 2 items with total 5, `offset=4` returns 1 item, and `offset=10` returns an empty list with total 5.
   - `limit=0`, `limit=101`, `offset=-1`, `tag=` and `tag=%20` each return 422.
   - Listed items include their sorted tags.
5. Document `GET /notes` in the README API section, including the parameters, defaults, ordering and response shape.

## Acceptance criteria

- [ ] `GET /notes` returns a `NotePage` ordered by `id` descending, with correct `total`, `limit` and `offset`.
- [ ] The tag filter is normalized (trimmed and lowercased) and matches exact tag names only.
- [ ] Out-of-range `limit` or `offset` and a blank `tag` return 422.
- [ ] Tags for a page are loaded without one query per note.
- [ ] Every case in Steps item 4 is in `tests/test_notes_list.py` (new) and passes.
- [ ] `POST /notes` and `GET /notes/{note_id}` behave as before; their tests still pass.
- [ ] `README.md` documents the listing parameters.

## Verification

```sh
.venv/bin/python -m pytest -q tests/test_notes_list.py tests/test_notes_create.py
.venv/bin/python -m ruff format --check .
grep -q 'def list_notes' app/repository.py
grep -q 'class NotePage' app/schemas.py
grep -q 'offset' README.md
NOTES_DB_PATH=/tmp/notes-t004-$$.db .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8767 &
trap 'kill $!' EXIT
sleep 2
curl -sf -o /dev/null -X POST http://127.0.0.1:8767/notes -H 'Content-Type: application/json' -d '{"title":"a","tags":["work"]}'
curl -sf -o /dev/null -X POST http://127.0.0.1:8767/notes -H 'Content-Type: application/json' -d '{"title":"b","tags":["home"]}'
curl -sf 'http://127.0.0.1:8767/notes?tag=WORK' | grep -qF '"total":1'
curl -sf 'http://127.0.0.1:8767/notes?limit=1&offset=1' | grep -qF '"title":"a"'
curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:8767/notes?limit=0' | grep -qx 422
```

Expected: the list and create tests pass. On the live server, the tag filter counts one note, the second page holds the older note, and `limit=0` returns 422.

## Risks and notes

- This task edits the same files as T-005 and T-006, so run them one at a time.
- Offset pagination can drift under concurrent writes. This is accepted per ADR-004.

## Log
