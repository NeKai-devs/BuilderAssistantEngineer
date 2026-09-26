# ADR-002: `createApp()` factory and in-process HTTP tests with supertest

- Status: Accepted
- Date: 2026-09-26

## Context
`src/index.ts:5-7` builds the app and listens on a fixed port at import time, and exports nothing. The only test is a placeholder (test/users.test.ts:3). The brief requires existing routes to keep working and the current test setup (Vitest) to stay.

## Decision
- `src/app.ts` exports `createApp(deps?: Partial<AppDeps>): Express`. It mounts routers and the error handler, with no `listen` and no env reads.
- Dependencies (store, mailer, clock, identity mode) are injected with safe defaults. `headerIdentityEnabled` defaults to `false` (fail closed).
- `src/index.ts` is the only module that reads env (via `src/config.ts`) and listens.
- HTTP tests use `supertest(createApp(...))` inside Vitest. Vitest stays the runner.
- `test/users.test.ts` becomes a characterization test for `GET /users`.

## Alternatives
- **Built-in `fetch` against `app.listen(0)`:** zero dependencies, but every test needs server start/stop boilerplate. This approach is used only for `scripts/smoke.mjs` (T-008), which must exercise the built artifact over real HTTP.
- **Spawn the built server in tests:** slow, port conflicts, and needs a build before tests. Rejected.

## Consequences
- New devDependencies: `supertest`, `@types/supertest`.
- The dependency-injection seam makes time and email deterministic in tests.
- The existing `users` named-export router stays as is. New routers that need dependencies are factories.
