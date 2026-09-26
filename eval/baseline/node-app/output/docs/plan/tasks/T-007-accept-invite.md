---
id: T-007
title: Implement POST /invites/accept with single-use, expiring, email-bound tokens
status: pending
phase: 2
depends_on: [T-006]
size: M
risk: medium
---
## Goal
An invitee accepts an invite by posting the emailed token and becomes a `member`. The team's member list reflects it. This completes the MVP flow: create, invite, accept, list.

## Context
- Owner agent: `backend`.
- Read first:
  - AGENTS.md
  - docs/plan/01-prd.md (`POST /invites/accept`, check order and codes)
  - ADR-005 (the token goes in the body, never the URL)
- Uses `hashInviteToken`, `store.findInviteByTokenHash` and `store.acceptInvite` (T-004), and the service from T-005/T-006. In tests, get the token from `MemoryMailer.sent`.
- An invite is expired when `now >= expiresAt`.

## Scope
- **In:**
  - `src/teams/service.ts` (`acceptInvite`)
  - `src/routes/invites.ts` (new: `invitesRouter({ service })`)
  - `src/app.ts` (mount `/invites` with `requireUser` and `express.json({ limit: "10kb" })`, above `errorHandler`)
  - `test/routes/invites.test.ts` (new)
- **Out:** resend/revoke, `GET /teams`, token-in-URL variants.

## Steps
1. Route `POST /accept` parses `{ token }` (string, 1–200 characters) and calls `service.acceptInvite(user, token)`.
2. Service, in the PRD order:
   1. look up by hash → 404 `invite_not_found`;
   2. status `accepted` → 409 `invite_already_used`;
   3. `now >= expiresAt` → 410 `invite_expired`;
   4. `user.email !== invite.email` → 403 `invite_email_mismatch`;
   5. `store.acceptInvite`. `not_pending` → 409 `invite_already_used`; `already_member` → 409 `already_member`; `not_found` → 404.
3. Respond 200 with `{ teamId, email, role, joinedAt }`.
4. Tests: see the acceptance criteria.

## Acceptance criteria
- [ ] Happy path: Alice creates a team and invites Bob. Bob posts the token and gets 200 with `{ teamId, email: "bob@example.com", role: "member", joinedAt }`. Then `GET /teams/:id/members` as Bob returns Alice (owner) and Bob (member).
- [ ] Accepting the same token again → 409 `invite_already_used`.
- [ ] After advancing the clock 7 days → 410 `invite_expired`, and Bob is not a member.
- [ ] Carol posting Bob's token → 403 `invite_email_mismatch`. Bob can still accept afterwards (200).
- [ ] An unknown token → 404 `invite_not_found`. Missing or empty token → 400 `validation_failed`. No header → 401.
- [ ] Bob, now a member, tries to invite someone → 403 `forbidden`.
- [ ] No route path contains `:token` (`grep` check below).
- [ ] `GET /users` is unchanged, and the full gate passes.

## Verification
```sh
npx vitest run test/routes/invites.test.ts test/routes/team-invites.test.ts test/routes/teams.test.ts test/users.test.ts
! grep -rq ":token" src/routes
git diff --quiet -- src/routes/users.ts
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```
All commands exit 0.

## Risks and notes
- The email check depends on the spoofable identity header (ADR-003). The token's secrecy is the real control. Don't log tokens anywhere.
- The check order reveals to a token holder whether the token is valid. That is acceptable, because only the holder of a 256-bit token can learn it.
