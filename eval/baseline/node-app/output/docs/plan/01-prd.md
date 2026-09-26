# PRD — Team accounts (MVP)

## Problem
The API has no concept of groups or shared access. The only resource is `GET /users`, which returns a hard-coded `[]` (src/routes/users.ts:5). Clients need teams that users can create, invite others to, and inspect.

## Actors
- **Caller**: any request carrying a valid identity (`X-User-Email`, see ADR-003).
- **Owner**: the team's creator. Can invite.
- **Member**: joined through an invite. Can list members.
- **Invitee**: the person at the invited email address. Receives a token by email.
- **Existing clients**: current users of `GET /users`.

## Goals and success criteria
1. The full create → invite → accept → list flow works over HTTP against the built app (`npm run smoke` passes).
2. `GET /users` still returns `200` with `[]` and a JSON content type (test/users.test.ts).
3. The CI gate (lint, format check, typecheck, tests, build, smoke) passes on every push and pull request.
4. Invite tokens never appear in API responses, URLs or logs, except the dev-only `ConsoleMailer`.

## Non-goals
Billing, SSO, UI, durable storage, real email delivery, listing a user's teams, resend/revoke, member removal, role changes, rate limiting.

## User stories
- **US-1 Create team.** As a caller, I create a team with a name and become its owner.
- **US-2 Invite.** As an owner, I invite an email address to join as a member. The invitee receives a token by email.
- **US-3 Accept.** As the invitee, I accept with the token and become a member.
- **US-4 List members.** As a team member (owner or member), I list the members and their roles.
- **US-5 No regression.** As an existing client, `GET /users` behaves exactly as before.

## API contract

All new endpoints require the header `X-User-Email: <email>`. The value is trimmed and lowercased. If it is missing, invalid, or header identity is disabled, the response is `401 unauthenticated`. Request bodies are JSON, max 10 kB.

Error body for every error:
```json
{ "error": { "code": "validation_failed", "message": "Request body is invalid", "details": [{ "path": "name", "message": "..." }] } }
```
`details` appears only for `validation_failed`.

### POST /teams
Request: `{ "name": "Acme" }`. `name` is a string, 1–100 characters after trimming.
`201`:
```json
{ "id": "3f0c…uuid", "name": "Acme", "createdAt": "2026-09-26T10:00:00.000Z" }
```
Errors: `400 validation_failed`, `400 invalid_json`, `401 unauthenticated`, `413 payload_too_large`.

### GET /teams/:teamId/members
`200`, sorted by `joinedAt` ascending, then `email`:
```json
[
  { "email": "alice@example.com", "role": "owner", "joinedAt": "2026-09-26T10:00:00.000Z" },
  { "email": "bob@example.com", "role": "member", "joinedAt": "2026-09-26T10:05:00.000Z" }
]
```
Errors: `401 unauthenticated`, `404 team_not_found` (the team doesn't exist **or** the caller isn't a member; the response is identical so existence isn't leaked).

### POST /teams/:teamId/invites
Request: `{ "email": "bob@example.com" }`.
Checks run in this order:
1. The caller is a member, else 404 `team_not_found`.
2. The caller is an owner, else 403 `forbidden`.
3. The body is valid, else 400.
4. The invitee is not already a member, else 409 `already_member`.
5. There is no unexpired pending invite for the same team and email, else 409 `invite_pending`.

`201` (never contains the token):
```json
{ "id": "…uuid", "teamId": "…uuid", "email": "bob@example.com", "role": "member", "status": "pending", "createdAt": "…", "expiresAt": "…(+7 days)" }
```
Side effect: `Mailer.sendInvite({ to, teamId, teamName, invitedBy, token, expiresAt })`. If sending fails, the invite is deleted and the response is `502 mail_delivery_failed`.
Errors: `400 validation_failed`, `400 invalid_json`, `401`, `403 forbidden`, `404 team_not_found`, `409 already_member`, `409 invite_pending`, `502 mail_delivery_failed`.

### POST /invites/accept
Request: `{ "token": "<token from email>" }`. The token goes in the body, never the URL (ADR-005).
Checks run in this order:
1. Body valid, else 400.
2. The token matches an invite, else 404 `invite_not_found`.
3. The invite is not already accepted, else 409 `invite_already_used`.
4. The invite has not expired, else 410 `invite_expired`.
5. The caller's email equals the invite email, else 403 `invite_email_mismatch`.
6. The caller is not already a member, else 409 `already_member`.

`200`:
```json
{ "teamId": "…uuid", "email": "bob@example.com", "role": "member", "joinedAt": "…" }
```

### Unchanged
- `GET /users` → `200 []` (JSON).
- Unknown paths keep Express's default 404 response.

## Non-functional requirements
- **Security:**
  - 256-bit random tokens, stored only as SHA-256 hashes, single-use, 7-day TTL, bound to the invitee email.
  - Header identity is off when `NODE_ENV=production` unless `ALLOW_HEADER_IDENTITY=true`.
  - Body limit 10 kB. 500 responses never expose internal messages or stacks.
- **Compatibility:** no change to existing paths. New middleware is scoped to `/teams` and `/invites`.
- **Observability:**
  - At startup, log the port and whether header identity is enabled.
  - Log 500s via `console.error`.
  - Request logging is deferred; it must redact tokens when added.
- **Testability:** time, store, mailer and identity mode are injected through `createApp(deps)`.

## Assumptions
See `00-overview.md` (A1–A9).

## Open questions
See the planner's QUESTIONS: identity mechanism, storage, email provider, membership rules, owner invites.
