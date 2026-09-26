# ADR-005: Invitation tokens and email delivery

- Status: Accepted (mailer provider pending Q3)
- Date: 2026-09-26

## Context
Owners invite by email, and invitees must prove they control that address. There is no user model, no email infrastructure and no auth (ADR-003).

## Decision
- **Token:** `crypto.randomBytes(32).toString("base64url")` (43 characters, 256 bits). Only `sha256(token)` in hex is stored. Lookup is by hash.
- **Lifecycle:** TTL 7 days (`INVITE_TTL_MS` in src/teams/service.ts). Single use (`pending → accepted`). Bound to the invitee email: the accepting identity must match.
- **One pending invite** per (team, email). A duplicate gets 409 `invite_pending`. An expired pending invite doesn't block a new one.
- **Acceptance:** `POST /invites/accept` with `{ "token" }` in the JSON body. The token never goes in a URL path or query, which keeps it out of access logs, proxies and history.
- **Delivery:** `Mailer` interface `sendInvite({ to, teamId, teamName, invitedBy, token, expiresAt })`.
  - `ConsoleMailer` (dev) prints the token to stdout.
  - `MemoryMailer` (tests, smoke) records messages.
  - Tokens never appear in API responses.
- **Send failure:** delete the invite and return `502 mail_delivery_failed`, so the owner can retry.

## Alternatives
- **Signed JWT invite tokens:** stateless, but single-use and revocation need state anyway. More moving parts. Rejected.
- **Token in the URL (`/invites/:token/accept`):** friendlier links, but leaks into logs. Rejected. A future frontend can put the token in a link to its own page, which then POSTs it.
- **Invite existing users by id:** there is no user model. Rejected.

## Consequences
- Resend and revoke are deferred.
- `ConsoleMailer` writes secrets to stdout. It is dev-only, and a real provider is needed before real use (Q3).
