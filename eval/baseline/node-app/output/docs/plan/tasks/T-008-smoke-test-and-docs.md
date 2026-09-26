---
id: T-008
title: Add built-app smoke script, run it in CI, and document the teams API
status: pending
phase: 2
depends_on: [T-007]
size: S
risk: low
---
## Goal
The compiled ESM app in `dist/` is proven to run the full create → invite → accept → list flow over real HTTP, locally and in CI. The README and architecture doc describe the new API, env vars and security caveats. This is the Phase 2 demo.

## Context
- Owner agents: `test-engineer` (script, CI), then `docs-writer` (README, docs, AGENTS.md status).
- Read first: AGENTS.md, docs/plan/01-prd.md (API contract), ADR-002 (why the smoke test uses `fetch` against `listen(0)`), ADR-003, ADR-005.
- The script imports from `dist/`, so run `npm run build` first. Node >= 22 provides global `fetch`.
- Current docs: README.md (2 lines) and docs/architecture.md:3 ("Routes live in src/routes."; keep that statement true).

## Scope
- **In:** `scripts/smoke.mjs` (new), package.json (`"smoke": "node scripts/smoke.mjs"`), `.github/workflows/ci.yml` (add `npm run smoke` after build), README.md, docs/architecture.md, AGENTS.md (Status section only).
- **Out:** source changes under `src/`, except a bug found by the smoke run. Any such fix gets its own note here.

## Steps
1. `scripts/smoke.mjs`:
   - Import `createApp` from `../dist/app.js`, `MemoryTeamStore` from `../dist/teams/memory-store.js` and `MemoryMailer` from `../dist/mail/memory-mailer.js`.
   - Build the app with `headerIdentityEnabled: true` and call `listen(0)`.
   - Run the flow with `fetch`:
     1. `GET /users` → `[]`
     2. Alice `POST /teams` → 201
     3. Alice invites Bob → 201
     4. Take the token from `mailer.sent[0]`
     5. Bob `POST /invites/accept` → 200
     6. Bob `GET /teams/:id/members` → 2 entries with the correct roles
   - Print `smoke ok`, close the server and exit 0. On any mismatch, print the step and response and exit 1. Set a 10-second overall timeout that exits 1.
2. Add the `smoke` script and the CI step.
3. README:
   - setup and scripts;
   - env vars `PORT`, `NODE_ENV`, `ALLOW_HEADER_IDENTITY`;
   - API reference for the four endpoints plus `GET /users`, with curl examples using `X-User-Email`;
   - the error envelope and codes;
   - a security caveats section (spoofable header, fail-closed production default, `ConsoleMailer` prints tokens, in-memory data lost on restart).
4. docs/architecture.md: a short module map and layering rules (routes → service → store). Link to docs/plan/.
5. AGENTS.md: update the Status section to show Phases 1 and 2 as done.

## Acceptance criteria
- [ ] `npm run build && npm run smoke` prints `smoke ok` and exits 0. Breaking any step (for example, a wrong expected role) makes it exit 1.
- [ ] CI runs `npm run smoke` after `npm run build`.
- [ ] README documents all four new endpoints, `X-User-Email`, the three env vars and the security caveats.
- [ ] docs/architecture.md still says routes live in `src/routes` and describes the new modules.
- [ ] The full gate passes.

## Verification
```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run smoke
grep -q "npm run smoke" .github/workflows/ci.yml
grep -q "POST /teams" README.md
grep -q "POST /invites/accept" README.md
grep -q "X-User-Email" README.md
grep -q "ALLOW_HEADER_IDENTITY" README.md
grep -q "src/routes" docs/architecture.md
```
All commands exit 0. `npm run smoke` prints `smoke ok`.

## Risks and notes
- `MemoryMailer` ships in `dist/` so the smoke script can use it. It has no side effects, so this is acceptable.
- If the smoke test exposes an ESM or packaging problem (for example, a missing `.js` extension), fix it in `src/` and record it here.
