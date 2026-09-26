<!-- bae:begin -->
# AGENTS.md — node-app

## Purpose
A small Express 5 + TypeScript HTTP API. Current initiative: add **team accounts**: teams, `owner`/`member` roles, owners invite users by email, invitees accept, and members list the team. Every existing route must keep working. Billing and SSO are out of scope.

The plan lives in `docs/plan/`. Tasks live in `docs/plan/tasks/T-*.md`.

## Status
- Phase 1 (baseline: T-001, T-002): not started.
- Phase 2 (teams MVP: T-003–T-008): not started.
- Until T-001 is done, `npm run typecheck`, `npm run format*` and a working CI do not exist, and `npm run build` is expected to fail.

Update this section when a phase completes.

## Stack
- Node.js >= 22 (ESM, `"type": "module"` in package.json:4). npm with package-lock.json.
- TypeScript 5, `strict`. Express ^5 (async handler errors reach error middleware automatically).
- Vitest 3 (test runner, keep it). supertest for HTTP tests (added in T-002).
- ESLint 9 flat config + typescript-eslint (T-001). Prettier 3 (T-001).
- zod 4 for request validation (T-003).

## Commands (run from repo root)
| Purpose | Command | Available from |
| --- | --- | --- |
| Install | `npm ci` | T-001 (lockfile is a stub before that) |
| Lint | `npm run lint` | now (lints TS from T-001) |
| Format / check | `npm run format` / `npm run format:check` | T-001 |
| Typecheck | `npm run typecheck` | T-001 |
| Test (all) | `npm test` | now |
| Test (one file) | `npx vitest run test/path/file.test.ts` | now |
| Build | `npm run build` (emits `dist/`) | T-001 |
| Run server | `npm start` (after build; `PORT` defaults to 3000; blocks) | T-002 |
| Smoke (built app, real HTTP) | `npm run smoke` (after build) | T-008 |

**Full gate** (must pass before a task is marked done): `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`.

Environment variables: `PORT` (default 3000), `NODE_ENV`, `ALLOW_HEADER_IDENTITY` (`true` enables header identity when `NODE_ENV=production`; see ADR-003).

## Architecture map
A `(T-xxx)` tag means the file does not exist until that task is done.

```text
src/
  index.ts              process entry: reads env (config.ts), wires deps, listens. The only file with side effects.
  app.ts        (T-002) createApp(deps): mounts routers and the error handler. No listen, no env reads.
  config.ts     (T-002) resolvePort(env); resolveHeaderIdentityEnabled(env) (T-005)
  cli.ts                placeholder bin, out of scope (FIXME at src/cli.ts:1)
  routes/users.ts       GET /users -> []   FROZEN: behavior must not change
  routes/teams.ts (T-005/T-006) POST /teams, GET /teams/:teamId/members, POST /teams/:teamId/invites
  routes/invites.ts (T-007) POST /invites/accept
  http/errors.ts (T-003) HttpError, errorHandler (JSON error envelope)
  http/validate.ts (T-003) parseBody(schema, body), emailSchema
  auth/identity.ts (T-003) requireUser({ enabled }), currentUser(res)
  teams/types.ts, store.ts, memory-store.ts, tokens.ts (T-004)
  teams/service.ts (T-005..T-007) business rules and authorization
  mail/mailer.ts, console-mailer.ts, memory-mailer.ts (T-006)
test/                   mirrors src/ (test/users.test.ts stays where it is)
  helpers/app.ts (T-005) buildTestApp(): app + store + mailer + controllable clock
scripts/smoke.mjs (T-008) end-to-end flow against dist/ over real HTTP
```

Layering: **routes** (HTTP parsing, DTOs, status codes) → **service** (rules, authorization) → **store** (data). Routes never import the store. `src/teams/*` never imports `express`.

API contract: `docs/plan/01-prd.md`.

## Conventions
- ESM with relative imports ending in `.js` (src/index.ts:2).
- Double quotes, semicolons, 2-space indent. Prettier enforces this from T-001.
- Routers live in `src/routes/<resource>.ts` (docs/architecture.md:3). The static router is a named export (src/routes/users.ts:3). Routers that need dependencies are factories: `export function teamsRouter(deps): Router`.
- Collections are returned as bare JSON arrays, matching `GET /users`.
- Error body: `{ "error": { "code": string, "message": string, "details"?: [{ "path", "message" }] } }`. Throw `HttpError`. Don't wrap async handlers (Express 5 forwards rejections).
- Normalize emails (trim + lowercase) at the HTTP boundary. The store compares exactly.
- Time comes from the injected `now()`. IDs come from `crypto.randomUUID()`. Invite tokens come only from `src/teams/tokens.ts`.
- Tests use Vitest + supertest against `createApp(...)`. No real ports or network except `scripts/smoke.mjs`. Tests ship in the same task as the code.
- Commits, only when the user asks: Conventional Commits with the task id, e.g. `feat(teams): accept invites (T-007)`. Never push.

## Do
- Read the whole task file, plus the ADRs and paths it lists, before editing. Stay inside its Scope.
- Keep `GET /users` byte-for-byte identical. `test/users.test.ts` is the guard.
- Mount new middleware (`express.json`, `requireUser`) on the new routers only, never app-wide.
- Record deviations and discoveries in the task file under "Risks and notes".
- Run the task's Verification block exactly as written.

## Don't
- Don't modify `src/routes/users.ts`, `src/cli.ts`, or anything about billing or SSO.
- Don't return invite tokens in API responses, put them in URLs, or log them (only `ConsoleMailer` prints them, for dev).
- Don't add a database, auth provider, email provider or global middleware without a new ADR.
- Don't add a global 404 handler. Unknown paths keep Express's default response.
- Don't edit `.bae/`. Don't use `sudo`, `rm -rf`, `git reset --hard`, force-push or piped installers.

## How to pick the next task
1. Read the frontmatter of every `docs/plan/tasks/T-*.md`.
2. If a task has `status: in_progress`, resume it.
3. Otherwise pick the lowest id with `status: pending` whose `depends_on` tasks are all `done`.
4. Set `status: in_progress`, implement, and run Verification. When everything passes and review is clean, set `status: done`.
5. If you are blocked, set `status: blocked` and explain why under "Risks and notes".
6. Never renumber or reuse ids. New work gets the next free id.

Statuses: `pending | in_progress | blocked | done`. The task frontmatter is the only source of status.

## Definition of done (every task)
- Every acceptance criterion is met, and the task's Verification commands exit 0.
- The full gate passes.
- README/docs are updated if commands or behavior changed.
- The reviewer agent reports no blocking findings.
<!-- bae:end -->
