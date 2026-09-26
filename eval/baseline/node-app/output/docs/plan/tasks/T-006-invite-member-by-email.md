---
id: T-006
title: Implement POST /teams/:teamId/invites with Mailer interface, console and memory mailers
status: pending
phase: 2
depends_on: [T-005]
size: M
risk: medium
---
## Goal
A team owner can invite an email address. A single-use, hashed, expiring token is created and delivered through a `Mailer`, and it never appears in the API response.

## Context
- Owner agent: `backend`.
- Read first:
  - AGENTS.md
  - docs/plan/01-prd.md (`POST /teams/:teamId/invites`, including check order and error codes)
  - ADR-005 (tokens and mailer), ADR-006
- Uses `generateInviteToken` (src/teams/tokens.ts), `store.findPendingInvite`, `createInvite` and `deleteInvite` (T-004), plus the service and router from T-005.
- The clock comes from `deps.now`. Use `INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000`.

## Scope
- **In:**
  - `src/mail/mailer.ts` (interface `Mailer`, type `InviteEmail`)
  - `src/mail/console-mailer.ts`, `src/mail/memory-mailer.ts`
  - `src/teams/service.ts` (`inviteMember`, `INVITE_TTL_MS`)
  - `src/routes/teams.ts` (new route)
  - `src/app.ts` (`mailer` in `AppDeps`, default `new ConsoleMailer()`)
  - `src/index.ts` (wire `ConsoleMailer`)
  - `test/helpers/app.ts` (add a `MemoryMailer` and return it)
  - `test/routes/team-invites.test.ts` (new)
- **Out:** acceptance (T-007), resend/revoke, real email provider.

## Steps
1. `mailer.ts`:
   - `export interface InviteEmail { to: string; teamId: string; teamName: string; invitedBy: string; token: string; expiresAt: Date }`
   - `export interface Mailer { sendInvite(msg: InviteEmail): Promise<void> }`
2. `ConsoleMailer.sendInvite` logs one line containing the recipient, team name, token and a note that it is dev-only. `MemoryMailer` pushes to `readonly sent: InviteEmail[]` and supports a `failNext()` switch for tests.
3. `service.inviteMember(user, teamId, { email })`, in the PRD order:
   1. membership, else 404 `team_not_found`;
   2. owner, else 403 `forbidden`;
   3. invitee already a member → 409 `already_member`;
   4. `findPendingInvite` → 409 `invite_pending`;
   5. generate the token and call `createInvite` with `expiresAt = now + INVITE_TTL_MS`;
   6. `mailer.sendInvite`. On throw, call `deleteInvite` and throw 502 `mail_delivery_failed`.
4. Route `POST /:teamId/invites`:
   - check authorization before body validation: the service does the membership and owner checks first, then the route parses `{ email }` with `emailSchema` (or pass a validation callback, whichever is simpler; keep the check order);
   - respond 201 with `{ id, teamId, email, role, status, createdAt, expiresAt }`.
5. Tests use `buildTestApp()` with a `MemoryMailer`.

## Acceptance criteria
- [ ] The owner invites `Bob@Example.com` → 201 with `email: "bob@example.com"`, `role: "member"`, `status: "pending"`, and `expiresAt` exactly 7 days after the clock's now.
- [ ] `mailer.sent` has exactly one message with `to: "bob@example.com"`, the correct `teamName`, and a 43-character token. The token string does not appear anywhere in the serialized response body, and the response has no `token` or `tokenHash` field.
- [ ] The stored invite's `tokenHash` equals `hashInviteToken(sentToken)`, and the raw token is not stored.
- [ ] Non-member → 404 `team_not_found`. A member who isn't an owner (seed through the store) → 403 `forbidden`.
- [ ] Invalid or missing email → 400 `validation_failed`. No header → 401.
- [ ] Inviting an existing member (including the owner) → 409 `already_member`.
- [ ] A second invite for the same email while one is pending → 409 `invite_pending`. After advancing the clock past 7 days, a new invite gets 201.
- [ ] With `failNext()`, the response is 502 `mail_delivery_failed`, and an immediate retry gets 201 (the failed invite was deleted).
- [ ] `GET /users` is unchanged, and the full gate passes.

## Verification
```sh
npx vitest run test/routes/team-invites.test.ts test/routes/teams.test.ts test/users.test.ts
git diff --quiet -- src/routes/users.ts
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```
All commands exit 0.

## Risks and notes
- `ConsoleMailer` prints secrets to stdout. It is dev-only (ADR-005, Q3), so document it in the README in T-008.
- There is no rate limiting yet, so an owner can trigger many emails. This is deferred and listed in the roadmap.
