---
id: T-004
title: Add team domain types, TeamStore interface with in-memory implementation, and invite token utilities
status: pending
phase: 2
depends_on: [T-001]
size: M
risk: low
---
## Goal
A tested data layer for teams, memberships and invites, plus secure token generation and hashing. The HTTP slices (T-005–T-007) are built on this.

## Context
- Owner agent: `backend`.
- Read first: AGENTS.md; ADR-004 (store) and ADR-005 (tokens) in docs/plan/03-decisions/; docs/plan/02-architecture.md ("Data model").
- This task is independent of T-002/T-003. It touches only `src/teams/*` and `test/teams/*`.
- Callers pass already-normalized emails. The store compares exactly.
- Atomicity: in `MemoryTeamStore`, every multi-step mutation must be one synchronous block. Mark the method `async`, but put no `await` between the checks and the writes.

## Scope
- **In:** `src/teams/types.ts`, `src/teams/store.ts`, `src/teams/memory-store.ts`, `src/teams/tokens.ts`, `test/teams/memory-store.test.ts`, `test/teams/tokens.test.ts`.
- **Out:** services, routes, HTTP concerns, any `express` import under `src/teams/`.

## Steps
1. `types.ts`: `Role`, `Team`, `Membership`, `Invite`, `NewInvite`, `AcceptResult`, exactly as in docs/plan/02-architecture.md.
   `AcceptResult = { ok: true; membership: Membership } | { ok: false; reason: "not_found" | "not_pending" | "already_member" }`.
2. `store.ts`: `export interface TeamStore`:
   - `createTeam(input: { name: string; ownerEmail: string; now: Date }): Promise<Team>` (also creates the owner membership with `joinedAt = now`)
   - `getTeam(teamId): Promise<Team | undefined>`
   - `getMembership(teamId, email): Promise<Membership | undefined>`
   - `listMembers(teamId): Promise<Membership[]>` (sorted by `joinedAt` ascending, then `email`; unknown team → `[]`)
   - `findPendingInvite(teamId, email, now): Promise<Invite | undefined>` (status pending and `expiresAt > now`)
   - `createInvite(input: NewInvite): Promise<Invite>`
   - `deleteInvite(inviteId): Promise<void>`
   - `findInviteByTokenHash(tokenHash): Promise<Invite | undefined>`
   - `acceptInvite(inviteId, now): Promise<AcceptResult>` (pending → accepted with `acceptedAt = now`, and adds a `member` membership with `joinedAt = now`; if the email is already a member, return `already_member` and leave the invite pending)
3. `memory-store.ts`: `export class MemoryTeamStore implements TeamStore`. Use `Map`s, `crypto.randomUUID()` for ids, and return shallow copies (Dates copied too) from every method.
4. `tokens.ts`:
   - `export function generateInviteToken(): { token: string; tokenHash: string }` (`randomBytes(32).toString("base64url")`)
   - `export function hashInviteToken(token: string): string` (SHA-256 hex)
5. Write the tests.

## Acceptance criteria
- [ ] `createTeam` returns a team with a UUID id, and `listMembers` then returns exactly one membership with role `owner` for the owner email.
- [ ] `getTeam` and `getMembership` return `undefined` for unknown ids or emails.
- [ ] `listMembers` order is `joinedAt` ascending, then `email` ascending (tested with at least 3 members, two of them with the same `joinedAt`).
- [ ] `findPendingInvite` ignores accepted invites and invites with `expiresAt <= now`.
- [ ] `acceptInvite`:
  - first call → `ok: true`, invite status `accepted`, member role `member`;
  - second call → `not_pending`;
  - unknown id → `not_found`;
  - existing member → `already_member`, and the invite stays `pending`.
- [ ] `deleteInvite` removes the invite (a following `findInviteByTokenHash` returns `undefined`).
- [ ] Mutating a returned object (for example `team.name = "x"`) doesn't change stored data.
- [ ] The token matches `/^[A-Za-z0-9_-]{43}$/`, `tokenHash` matches `/^[0-9a-f]{64}$/`, `hashInviteToken(token) === tokenHash`, and 1000 generated tokens are all distinct.
- [ ] No file in `src/teams/` imports `express`.
- [ ] The full gate passes.

## Verification
```sh
npx vitest run test/teams/memory-store.test.ts test/teams/tokens.test.ts
! grep -rq 'from "express"' src/teams
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```
All commands exit 0. The `grep` line passes when no `express` import exists under `src/teams`.

## Risks and notes
- A future database implementation must use transactions for `createTeam` and `acceptInvite`, and unique constraints on `(teamId, email)`. Keep the interface method-per-use-case so that stays possible.
