---
id: T-005
title: Implement POST /teams and GET /teams/:teamId/members with injected dependencies
status: pending
phase: 2
depends_on: [T-003, T-004]
size: M
risk: medium
---
## Goal
A caller can create a team (and become its owner) and list its members over HTTP. `createApp` is wired with injected dependencies and the fail-closed identity mode. This is the first user-visible slice of the teams feature.

## Context
- Owner agent: `backend`.
- Read first:
  - AGENTS.md
  - docs/plan/01-prd.md (`POST /teams`, `GET /teams/:teamId/members`)
  - ADR-002, ADR-003, ADR-006
- Building blocks: `src/http/errors.ts`, `src/http/validate.ts`, `src/auth/identity.ts` (T-003); `src/teams/*` (T-004).
- Layering: the route calls the service, and the service calls the store. The route never imports the store.
- `errorHandler` must stay the last `app.use` in `src/app.ts`.

## Scope
- **In:**
  - `src/teams/service.ts` (new: `createTeamService({ store, now })` with `createTeam` and `listMembers`)
  - `src/routes/teams.ts` (new: `teamsRouter({ service })`)
  - `src/app.ts` (`AppDeps`, mount `/teams`)
  - `src/config.ts` (`resolveHeaderIdentityEnabled`)
  - `src/index.ts` (wiring and startup log)
  - `test/helpers/app.ts` (new), `test/routes/teams.test.ts` (new), `test/config.test.ts` (extend)
- **Out:** invites (T-006/T-007), `GET /teams`, changes to `/users`.

## Steps
1. In `src/app.ts`, add `export interface AppDeps { store: TeamStore; now: () => Date; headerIdentityEnabled: boolean }` and `createApp(deps: Partial<AppDeps> = {})`, with defaults `new MemoryTeamStore()`, `() => new Date()` and `false`.
   Mount `app.use("/teams", requireUser({ enabled }), express.json({ limit: "10kb" }), teamsRouter({ service }))` above `errorHandler`. Leave `/users` exactly as is.
2. Service:
   - `createTeam(user, { name })` trims the name and calls `store.createTeam`.
   - `listMembers(user, teamId)` throws `HttpError(404, "team_not_found", "Team not found")` when the team is missing or the caller isn't a member.
3. Router:
   - `POST /` parses `{ name }` with zod (string, trimmed, 1–100) and returns 201 `{ id, name, createdAt }` with ISO dates.
   - `GET /:teamId/members` returns 200 as a bare array of `{ email, role, joinedAt }`.
4. `src/config.ts`: `resolveHeaderIdentityEnabled(env)` returns `env.NODE_ENV !== "production" || env.ALLOW_HEADER_IDENTITY === "true"`.
   `src/index.ts`: build `MemoryTeamStore`, pass `headerIdentityEnabled`, and log `header identity: enabled|disabled` at startup.
5. `test/helpers/app.ts`: `buildTestApp(overrides?)` returns `{ app, store, clock }` with `headerIdentityEnabled: true` and a controllable clock `{ now(): Date; advance(ms: number): void }` starting at `2026-01-01T00:00:00Z`.
6. Tests: see the acceptance criteria.

## Acceptance criteria
- [ ] `POST /teams` with `X-User-Email: Alice@Example.com` and `{ "name": "  Acme " }` returns 201 with a UUID `id`, `name: "Acme"` and an ISO `createdAt`.
- [ ] `name` missing, `""`, `"   "`, 101 characters, or a number → 400 `validation_failed`.
- [ ] Malformed JSON → 400 `invalid_json`. No header → 401 `unauthenticated`. An app built with `headerIdentityEnabled: false` → 401 even with a valid header.
- [ ] `GET /teams/:id/members` as the creator returns 200 `[{ "email": "alice@example.com", "role": "owner", "joinedAt": <ISO> }]`.
- [ ] A non-member or an unknown team id gets 404 `team_not_found` with identical bodies.
- [ ] `GET /users` on an app built with `buildTestApp()` still returns 200 `[]`.
- [ ] `resolveHeaderIdentityEnabled`: `{}` → true; `{ NODE_ENV: "production" }` → false; `{ NODE_ENV: "production", ALLOW_HEADER_IDENTITY: "true" }` → true.
- [ ] `src/routes/teams.ts` doesn't import from `src/teams/store` or `src/teams/memory-store`.
- [ ] The full gate passes.

## Verification
```sh
npx vitest run test/routes/teams.test.ts test/config.test.ts test/users.test.ts
! grep -Eq "teams/(memory-)?store" src/routes/teams.ts
git diff --quiet -- src/routes/users.ts
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```
All commands exit 0.

## Risks and notes
- The header identity is spoofable (ADR-003). The fail-closed default in `createApp` and the production rule in `config.ts` are the safety net, and both must be tested.
- The members-list response is a bare array to match `GET /users`. Pagination is deferred.
