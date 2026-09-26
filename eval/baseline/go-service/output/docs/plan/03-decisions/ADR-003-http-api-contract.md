# ADR-003: HTTP API contract

- Status: Accepted (user fields provisional until Q1 is answered)
- Date: 2026-09-26

## Context
Other services integrate programmatically, so responses must be predictable and easy for machines to read. The brief fixes the paths: `/health` and `/users`.

## Decision
- JSON in both directions. Responses use gin's `application/json; charset=utf-8`. The request `Content-Type` is not enforced.
- `GET /health` returns `200 {"status":"ok"}`.
- `POST /users`:
  - request: `{"name": string, "email": string}`;
  - response: `201 {"id": string, "name": string, "email": string}`.
- `GET /users` returns `200 {"users":[User...]}` in creation order. It is wrapped in an object so pagination metadata can be added later without breaking callers.
- Validation is done with hand-written code and the standard library, not gin binding tags:
  - `name`: trimmed, 1-100 runes;
  - `email`: trimmed, 1-254 bytes, and `mail.ParseAddress` must succeed with `addr.Address == email`, which rejects forms like `"Bob <b@x.io>"`.
- The request body is capped at 1 MiB via `http.MaxBytesReader`. Unknown JSON fields are ignored, so callers can evolve.
- Error envelope: `{"error":{"code":"<snake_case>","message":"<human text>"}}`.

| Status | code | When |
| --- | --- | --- |
| 400 | `invalid_json` | body missing, malformed, or not a JSON object |
| 400 | `validation_failed` | a field fails validation; the message names the field |
| 404 | `not_found` | unknown path |
| 405 | `method_not_allowed` | known path, unsupported method |
| 409 | `email_taken` | email already exists (ignoring case) |
| 413 | `payload_too_large` | body over 1 MiB |
| 500 | `internal` | unexpected error or panic; generic message |

- Phase 3: every response carries `X-Request-ID`.
- Paths are unversioned, as the brief specifies.

## Alternatives considered
- **gin `binding:"required,email"` tags.** Rejected: the error messages expose Go struct names (`Key: 'createUserRequest.Email'...`), and they don't trim input.
- **422 for validation errors.** Rejected: 400 plus a distinct `code` is simpler for internal callers. Either would work.
- **RFC 9457 `application/problem+json`.** Rejected: more ceremony than internal callers need. `code` + `message` covers them.
- **A bare JSON array for the list.** Rejected: it can't grow pagination metadata without a breaking change.
- **A `/v1/` prefix.** Rejected: the brief names `/users`. Revisit when the first breaking change comes up.

## Consequences
- `docs/api.md` is the published contract and must change in the same task as any behavior change.
- Adding fields to the response is non-breaking. Renaming or removing them is breaking.
