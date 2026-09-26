---
id: T-003
title: Implement POST /notes and GET /notes/{note_id} with validation and tag normalization
status: pending
phase: 1
depends_on: [T-002]
size: M
risk: medium
---
## Goal
When this is done, clients can create a note with a title, body and tags, and fetch it by ID, with the PRD's validation rules enforced. This task also sets the pattern (schemas, repository, router, tests) that T-004 to T-006 reuse.

## Context
- Suggested agent: backend.
- Read first: AGENTS.md; `docs/plan/01-prd.md` (FR-1, FR-2, the validation table); ADR-003; ADR-004; `app/db.py`; `app/main.py`; `tests/conftest.py`.
- **Tags:** tag normalization lives only in `normalize_tag()`. List-level work (dedupe and sort) is a second validator applied to the list.
- **Type coercion:** Pydantic v2 doesn't convert numbers to strings by default, so `{"title": 123}` is a 422. Keep it that way.
- **Location header:** set it through a `Response` parameter (`response.headers["Location"] = f"/notes/{note.id}"`).
- **Transactions:** write the note row and its tag rows in one `with conn:` block. Put tag writes in a module-level helper, `_replace_tags(conn, note_id, tags)`, which T-005 reuses.
- **Timestamps:** use one `now` value for both `created_at` and `updated_at`, stored as `datetime.now(UTC).isoformat(timespec="microseconds")`.

## Scope
In:
- `app/schemas.py` (new): `TAG_PATTERN`, `normalize_tag`, `Tag`, `Tags`, `Title`, `Body`, `NoteCreate`, `Note`
- `app/repository.py` (new): `create_note`, `get_note`, `_replace_tags`, row-to-model helper
- `app/notes.py` (new): APIRouter with `POST /notes` and `GET /notes/{note_id}`
- `app/main.py`: include the router
- `tests/test_schemas.py` (new)
- `tests/test_notes_create_get.py` (new)
- `README.md`: API section

Out: list, update, delete; `ListParams`; any change to the error format.

## Steps
1. `app/schemas.py`:
   - `Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]`
   - `Body = Annotated[str, StringConstraints(max_length=10_000)]`
   - `normalize_tag(value: str) -> str`: `v = value.strip().lower()`. If `re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,31}", v)` fails, raise `ValueError` with a clear message.
   - `Tag = Annotated[str, AfterValidator(normalize_tag)]`
   - `Tags = Annotated[list[Tag], Field(max_length=20), AfterValidator(lambda v: sorted(set(v)))]`
   - `NoteCreate`: `extra="forbid"`; fields `title: Title`, `body: Body = ""`, `tags: Tags = Field(default_factory=list)`.
   - `Note`: fields `id: int`, `title: str`, `body: str`, `tags: list[str]`, `created_at: datetime`, `updated_at: datetime`.
2. `app/repository.py`:
   - `create_note(conn, data: NoteCreate) -> Note`
   - `get_note(conn, note_id: int) -> Note | None`, which reads tags with `ORDER BY tag`.
3. `app/notes.py`:
   - `router = APIRouter(prefix="/notes", tags=["notes"])`.
   - Sync `def` endpoints: `POST ""` with `status_code=201` and `response_model=Note`; `GET "/{note_id}"`.
   - Missing notes raise `HTTPException(404, "Note not found")`.
4. `app/main.py`: `app.include_router(notes.router)` inside `create_app`.
5. Tests; then a README API section with curl examples.

## Acceptance criteria
- [ ] `POST /notes` with `{"title": "  First  ", "body": "hello", "tags": ["Work", " ideas ", "work"]}` returns 201 with:
  - `id` an integer ≥ 1, `title` `"First"`, `body` `"hello"`, `tags` `["ideas", "work"]`
  - `created_at` equal to `updated_at`, both parseable ISO 8601 with a UTC offset
  - header `Location: /notes/{id}`
- [ ] `POST /notes` with `{"title": "x"}` returns 201 with `body` `""` and `tags` `[]`.
- [ ] Each of these returns 422, one test case each:
  - missing `title`; title `"   "`; a 201-char title; `title: 123`; `title: null`
  - a 10,001-char body
  - 21 distinct tags; tag `"bad tag"`; tag `""`; a 33-char tag; tag `"-x"`; `tags` given as a string
  - an unknown field `color`
- [ ] Boundary values are accepted: a 200-char title, a 10,000-char body, 20 tags, a 32-char tag.
- [ ] `GET /notes/{id}` returns 200 with JSON identical to the POST response.
- [ ] `GET /notes/999999` returns 404 `{"detail": "Note not found"}`. `GET /notes/abc` returns 422.
- [ ] A note created through one app instance is returned by a new `create_app` instance on the same DB file.
- [ ] `tests/test_schemas.py` unit-tests `normalize_tag`: strip, lowercase, allowed characters, and each rejection case.
- [ ] OpenAPI lists `POST /notes` and `GET /notes/{note_id}`.
- [ ] The `README.md` API section documents both endpoints with curl examples.
- [ ] All Check commands pass; coverage ≥ 90%. No new `# noqa`.

## Verification
```sh
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
.venv/bin/python -m mypy
.venv/bin/python -m pytest -q tests/test_schemas.py tests/test_notes_create_get.py
.venv/bin/python -m pytest -q --cov=app --cov-report=term-missing --cov-fail-under=90
.venv/bin/python -c "from app.main import app; p = app.openapi()['paths']; assert 'post' in p['/notes'] and 'get' in p['/notes/{note_id}']"
grep -q "POST /notes" README.md
```
All commands exit 0. The 422 cases are parametrized tests, one case per row above.

## Risks and notes
- This task sets the patterns T-004 to T-006 copy, so keep the router thin and all SQL in the repository.
- If the validation limits change (open question 3), update `schemas.py`, these tests and PRD section "Validation rules" together.
</br>
