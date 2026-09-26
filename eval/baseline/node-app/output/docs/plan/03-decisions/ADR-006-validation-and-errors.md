# ADR-006: Request validation and error contract

- Status: Accepted
- Date: 2026-09-26

## Context
New endpoints accept JSON bodies and need consistent 4xx responses. There is no validation or error handling today (src/index.ts:1-7). Existing behavior (`GET /users`, Express's default 404 for unknown paths) must not change.

## Decision
- **Validation:** zod 4 schemas through `parseBody(schema, body ?? {})`. On failure it throws `HttpError(400, "validation_failed", …, details)`. `emailSchema` trims, lowercases, allows max 254 characters and validates the format.
- **Errors:** `HttpError(status, code, message, details?)` with a single `errorHandler`, registered last in `createApp`:
  - `HttpError` → its status and the envelope `{ error: { code, message, details? } }`.
  - body-parser `entity.parse.failed` → 400 `invalid_json`. `entity.too.large` → 413 `payload_too_large`.
  - Anything else → `console.error` and 500 `internal_error` with a generic message.
- **Body parsing:** `express.json({ limit: "10kb" })` is mounted only on `/teams` and `/invites`. No global 404 handler.
- **Async:** Express 5 native rejection forwarding. No async wrappers.
- **Status rules:** 404 when the caller can't see the team. 403 only for members who lack permission. 409 for state conflicts. 410 for expired invites.
- Services throw `HttpError` directly. This is acceptable at this size; revisit if a second transport appears.
- Collections are bare arrays, following the `GET /users` convention.

## Alternatives
- **Hand-rolled validators:** no dependency, but they drift and lose type inference as the API grows.
- **express-validator:** middleware chains with weaker TypeScript inference.
- **joi/celebrate:** heavier, and types are separate from schemas.

## Consequences
- One runtime dependency (`zod`). Agents must use the v4 API of the installed major.
- A uniform error shape for clients and tests.
