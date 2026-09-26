# PRD: internal notes API

## Problem
Internal teams need a simple HTTP service to store short notes and organize them with tags. Today the service exposes only `GET /health` (`app/main.py:6-8`).

## Users
Engineers and internal services on a trusted network, using curl, scripts or other backends. They are not end users in a browser; there is no UI.

## Goals
- G1. Create, read, list, update and delete notes, each with a title, a body and tags.
- G2. Enforce clear input validation with predictable 4xx responses.
- G3. Persist data in a single SQLite file that survives restarts.
- G4. Run on Linux with Python 3.12, with a simple and documented operating procedure.
- G5. Keep behavior locked down by automated tests and CI.

## Non-goals
- **Out of scope:** authentication or authorization, and a web UI.
- **Deferred:**
  - endpoint listing all tags (`GET /tags`)
  - full-text search and custom sort orders
  - optimistic concurrency (ETag / If-Match)
  - soft delete, undo, bulk operations
  - Docker image, Postgres, lockfile, rate limiting, metrics endpoint

## Functional requirements
| ID | Requirement | Task |
| --- | --- | --- |
| FR-1 | `POST /notes` creates a note from `title`, optional `body` (default `""`) and optional `tags` (default `[]`). Returns 201, the note, and `Location: /notes/{id}`. | T-003 |
| FR-2 | `GET /notes/{note_id}` returns the note or 404 `{"detail": "Note not found"}`. | T-003 |
| FR-3 | `GET /notes` returns `{"items", "total", "limit", "offset"}`, ordered by `updated_at` DESC then `id` DESC. `limit` is 1-200 (default 50); `offset` ≥ 0 (default 0). The `tag` parameter can repeat; a note must have all given tags (AND). | T-004 |
| FR-4 | `PATCH /notes/{note_id}` updates any of `title`, `body`, `tags` (at least one is required; `null` is not allowed). A provided `tags` list replaces the whole set. Sets a new `updated_at`. Returns 200 with the note, or 404. | T-005 |
| FR-5 | `DELETE /notes/{note_id}` permanently deletes the note and its tags. Returns 204, or 404. Deleted IDs are never reused. | T-006 |
| FR-6 | `GET /health` returns 200 `{"ok": true}` when the DB can be queried, and 503 `{"ok": false}` otherwise. | T-007 (today it always returns 200) |
| FR-7 | Data persists across restarts. The schema is created or migrated automatically at startup. | T-002 |

**Note representation:**
```json
{"id": 1, "title": "First", "body": "hello", "tags": ["ideas", "work"],
 "created_at": "2026-09-26T10:15:30.123456Z", "updated_at": "2026-09-26T10:15:30.123456Z"}
```

## Validation rules
| Field | Rule | On violation |
| --- | --- | --- |
| `title` | string; whitespace is trimmed at both ends; 1-200 chars after trimming; required on create; not `null` on PATCH | 422 |
| `body` | string; stored as-is; 0-10,000 chars; not `null` on PATCH | 422 |
| `tags` | list of at most 20 strings in the request. Each tag is trimmed, lowercased, and must match `^[a-z0-9][a-z0-9_-]{0,31}$`. Duplicates (after normalization) collapse into one; the response is sorted. | 422 |
| unknown body fields | rejected | 422 |
| `limit` / `offset` | integers; `1 ≤ limit ≤ 200`; `offset ≥ 0` | 422 |
| `tag` query parameter | same normalization and rule as `tags` | 422 |
| `note_id` | integer path parameter | 422 if not an integer; 404 if it doesn't exist |

Validation errors use FastAPI's default 422 body (`{"detail": [ ... ]}`).

## Non-functional requirements
- **Platform:** Linux, CPython 3.12, a single uvicorn worker, one SQLite file (WAL mode).
- **Security:**
  - No auth, so the service must listen only on localhost or an internal interface.
  - All SQL is parameterized (enforced by ruff `S608`).
  - Input sizes are bounded by the validation rules above.
  - Note content is never logged.
- **Reliability:**
  - Every write is a single transaction.
  - Migrations are atomic and safe when two processes start at once.
  - There is a documented backup procedure (T-008).
- **Observability:** a health endpoint with a DB check, a startup log line (DB path and schema version), and uvicorn access logs to stdout/journald.
- **Quality gates in CI:** ruff lint and format, mypy strict, pytest with coverage ≥ 90%, and the smoke test (from T-008).
- **Scale target (assumption, not load-tested):** fewer than 100k notes and low write rate (under 10 writes/s).

## Success criteria
- FR-1 to FR-5 are implemented, and every row of the validation table is covered by at least one test (end of Phase 2).
- The CI workflow runs green on Python 3.12, with coverage ≥ 90%.
- `scripts/smoke.py` passes against a real uvicorn process, including persistence across a restart (end of Phase 3).

## Assumptions
- A1. Consumers are on a trusted internal network; no authentication (from the brief).
- A2. One service instance, one uvicorn worker, low write concurrency.
- A3. Data volume under 100k notes; tag filtering is the only search needed.
- A4. The validation limits above (title 200, body 10,000, 20 tags, the tag pattern) are acceptable.
- A5. Tags are case-insensitive and stored in lowercase.
- A6. PATCH does partial updates; sending `tags` replaces the whole set; the last write wins.
- A7. Deletes are permanent (hard delete).
- A8. Repeated `tag` filters combine with AND.
- A9. CI runs on GitHub Actions (no git remote is configured, so this is unconfirmed).
- A10. Deployment uses a venv plus systemd on Linux hosts that have `python3.12`; no container.
- A11. Timestamps are generated by the server, in UTC.
- A12. Dev machines have Python ≥ 3.12; CI pins 3.12.

## Open questions
These are the questions returned with the plan. None blocks work.
1. Which CI host? (A9)
2. Which deployment model? (A10)
3. Are the validation limits and tag rules right? (A4, A5)
4. Is the PATCH / last-write-wins / hard-delete / AND-filter contract right? (A6-A8)
5. Is a lockfile needed?
