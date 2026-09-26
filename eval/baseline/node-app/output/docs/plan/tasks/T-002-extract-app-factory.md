---
id: T-002
title: Extract createApp() factory, read PORT from env, and pin GET /users with an HTTP test
status: pending
phase: 1
depends_on: [T-001]
size: S
risk: low
---
## Goal
The Express app can be built in-process without listening, and `GET /users` is protected by a real HTTP characterization test. Every later task relies on this test to prove existing routes keep working.

## Context
- Owner agent: `backend`.
- Read first: AGENTS.md, docs/plan/03-decisions/ADR-002-app-factory-http-tests.md.
- Current entry point: src/index.ts:1-7. It builds the app, mounts `/users`, calls `listen(3000)`, and has a TODO at line 4 to read the port from env.
- Route: src/routes/users.ts:3-5 (frozen; don't edit). Placeholder test: test/users.test.ts:1-3.
- Vitest resolves `../src/app.js` imports to `.ts` sources.

## Scope
- **In:**
  - `src/app.ts` (new)
  - `src/config.ts` (new, `resolvePort`)
  - `src/index.ts`
  - `test/users.test.ts` (rewrite)
  - `test/config.test.ts` (new)
  - package.json (devDependencies `supertest`, `@types/supertest`; script `"start": "node dist/index.js"`) and the lockfile
- **Out:** src/routes/users.ts, error handling (T-003), any new routes.

## Steps
1. Run `npm install -D supertest @types/supertest`. Add the `start` script.
2. Create `src/app.ts`: `export function createApp(): Express` builds `express()`, mounts `app.use("/users", users)`, and returns the app. No `listen`, no `process.env`.
3. Create `src/config.ts`: `export function resolvePort(env: NodeJS.ProcessEnv): number`.
   - Unset or empty returns `3000`.
   - An integer string from 0 to 65535 returns the number.
   - Anything else throws `Error("Invalid PORT: <value>")`.
4. Rewrite `src/index.ts`: `const port = resolvePort(process.env); createApp().listen(port, () => console.log(\`node-app listening on port ${port}\`));`. Remove the TODO.
5. Rewrite `test/users.test.ts` with supertest:
   - `GET /users` returns 200, content type matching `/application\/json/`, and body `[]`.
   - `GET /does-not-exist` returns 404. This pins Express's default behavior for unknown paths.
6. Create `test/config.test.ts` for `resolvePort`: unset → 3000, `""` → 3000, `"8080"` → 8080, `"0"` → 0; `"abc"`, `"70000"`, `"-1"` and `"3.5"` throw.

## Acceptance criteria
- [ ] `createApp` is exported from `src/app.ts`, and importing it does not open a port.
- [ ] `test/users.test.ts` asserts status 200, JSON content type and `[]` for `GET /users`, and 404 for an unknown path.
- [ ] The `resolvePort` cases above are covered and pass.
- [ ] `src/index.ts` no longer contains the port TODO and reads `PORT` via `resolvePort`.
- [ ] `src/routes/users.ts` is unchanged (`git diff --quiet -- src/routes/users.ts`).
- [ ] The full gate passes.

## Verification
```sh
npx vitest run test/users.test.ts test/config.test.ts
git diff --quiet -- src/routes/users.ts
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
node --input-type=module -e "const m = await import('./dist/app.js'); if (typeof m.createApp !== 'function') process.exit(1);"
```
All commands exit 0. The last line proves the built factory loads without starting a server; the process exits by itself.

## Risks and notes
- Don't change `GET /users` in any way, including adding middleware. This test is the regression guard for the rest of the plan.
- Manual check (optional, not part of the gate): `npm run build && PORT=4000 npm start`, then `curl -s localhost:4000/users` returns `[]`.
