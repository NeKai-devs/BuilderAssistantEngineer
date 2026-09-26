# Architecture

## Current state (evidence)
| Area | Evidence | Observation |
| --- | --- | --- |
| Module system | package.json:4 | ESM package (`"type": "module"`) |
| Framework | package.json:12-14 | `express ^5.0.0`, the only runtime dependency |
| Build/test/lint scripts | package.json:7-11 | `tsc`, `vitest run`, `eslint .`. No typecheck or format script |
| Entry point | src/index.ts:1-7 | Builds the app, mounts `/users`, calls `app.listen(3000)` at import time. Nothing is exported, so it can't be tested in-process. TODO for the port at line 4 |
| Routes | src/routes/users.ts:3-5 | Only route: `GET /users` returns a literal `[]`. Router is a named export. TODO: paginate (line 4) |
| Data / auth | src/ (4 files total) | No persistence, no user model, no authentication |
| Tests | test/users.test.ts:1-3 | One placeholder asserting `1 === 1`. No HTTP coverage |
| TypeScript | tsconfig.json:1 | Only `strict` and `outDir`. No `module`, `target`, `include` or `rootDir` |
| Types | package.json:15-19 | No `@types/express` or `@types/node` |
| Lint | eslint.config.js:1 | `export default []`: no rules and no TS parser |
| Formatter | — | None |
| CI | .github/workflows/ci.yml:2,6-7 | Runs on push only. A single `npm test` step with no checkout, Node setup or install |
| Lockfile | package-lock.json:1 | `{ "lockfileVersion": 3 }` only; no packages resolved |
| Ignore rules | .gitignore:1-4 | `node_modules/` not ignored. File has uncommitted local changes |
| CLI | src/cli.ts:1-2 | Placeholder, no shebang (the `bin` in package.json:6 won't run directly). FIXME at line 1 |
| Docs | README.md, docs/architecture.md:3 | Minimal. "Routes live in src/routes." |

### Baseline defects
Inferred by reading config. Nothing was run during planning. T-001 must confirm and fix them.
- **D1:** `tsc` under `strict` fails on `import express from "express"` because there are no type declarations (TS7016).
- **D2:** With no `module` set, TS 5.x emits CommonJS (default target ES5). Node loads it as ESM because of package.json:4, so it fails at runtime (`exports is not defined in ES module scope`).
- **D3:** With no `rootDir`/`include`, `test/` is compiled too. Output lands in `dist/src/index.js`, not the `dist/index.js` and `dist/cli.js` that package.json:5-6 point to.
- **D4:** `npm ci` can't install from the stub lockfile. CI fails before any test because the repo is never checked out.
- **D5:** ESLint 9 with an empty flat config only matches `*.js/*.mjs/*.cjs`, so no TypeScript is linted.
- **D6:** `node_modules/` would be committed after the first install.

## Target state

### Module map
```text
src/index.ts ──> config.ts (env)          [side effects live only here]
     │
     └──> app.ts  createApp({ store, mailer, now, headerIdentityEnabled })
            ├── /users    routes/users.ts                        (unchanged, no new middleware)
            ├── /teams    requireUser → express.json → routes/teams.ts
            ├── /invites  requireUser → express.json → routes/invites.ts
            └── errorHandler (http/errors.ts)                    (last)

routes/*  ──> teams/service.ts ──> teams/store.ts (TeamStore interface)
                    │                    └── teams/memory-store.ts
                    ├──> teams/tokens.ts (randomBytes + sha256)
                    └──> mail/mailer.ts (Mailer interface)
                              ├── mail/console-mailer.ts (dev)
                              └── mail/memory-mailer.ts  (tests, smoke)
```

### Data model (domain types, `src/teams/types.ts`)
```ts
type Role = "owner" | "member";
interface Team { id: string; name: string; createdBy: string; createdAt: Date }
interface Membership { teamId: string; email: string; role: Role; joinedAt: Date }
interface Invite {
  id: string; teamId: string; email: string; role: "member";
  tokenHash: string; status: "pending" | "accepted";
  invitedBy: string; createdAt: Date; expiresAt: Date; acceptedAt?: Date;
}
```
Rules:
- Unique `(teamId, email)` membership.
- At most one unexpired pending invite per `(teamId, email)`.
- Emails are stored normalized.

### Request flow (accept invite)
1. `requireUser` resolves `{ email }` from the header.
2. `express.json` parses the body.
3. The route runs `parseBody` with a zod schema.
4. `service.acceptInvite` hashes the token and looks it up, checks status, expiry and email, then calls `store.acceptInvite`. That call is one synchronous critical section: it marks the invite accepted and adds the membership together.
5. The route maps the result to a DTO with ISO dates.
6. Errors travel as `HttpError` to `errorHandler`.

### Security
- Identity is a replaceable seam (ADR-003). It is off in production by default, and then the new routes answer 401 while `/users` is unaffected.
- Tokens: 32 bytes from `crypto.randomBytes`, base64url. Only the SHA-256 hex is stored. Accepted from the body only. Never in responses (ADR-005).
- Input: zod schemas, 10 kB body limit, no stack traces in responses (ADR-006).
- Authorization: non-members get 404 (no existence leak). Members without permission get 403.

### Error handling and observability
- A single JSON error envelope comes from `errorHandler`.
- Express 5 forwards async rejections, so no wrappers are needed.
- Logs: startup line (port, identity mode) and `console.error` for unexpected errors. Structured request logging is deferred.

## Migration path
1. **T-001:** config-only fixes. Runtime code unchanged except formatting and type-only edits.
2. **T-002:** split `src/index.ts` into `app.ts` (factory) and `index.ts` (env + listen). The HTTP test pins `GET /users` before any feature work.
3. **T-003–T-007:** additive only. New paths (`/teams`, `/invites`) and new files. The error handler is the only app-level addition, and it cannot change `/users`, which never errors.
4. **T-008:** smoke test against `dist/` in CI.

Rollback at any point is reverting the task's commit. There are no data migrations because storage is in memory.

## Debt register (not addressed by this plan)
- `/users` pagination TODO (src/routes/users.ts:4). Changing it would break "existing routes keep working".
- CLI argument parsing FIXME and missing shebang (src/cli.ts:1-2).
- `main` (package.json:5) points to a module that starts a server on import. Consumers importing the package get a side effect. This is kept for compatibility.
- The header identity, in-memory store and console mailer are MVP placeholders (Q1–Q3).
