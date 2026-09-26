---
id: T-003
title: Add HTTP foundation - HttpError and error handler, zod body validation, header identity middleware
status: pending
phase: 2
depends_on: [T-002]
size: M
risk: low
---
## Goal
Reusable, tested building blocks for the teams endpoints: a uniform JSON error envelope, typed body validation, and the `X-User-Email` identity middleware that fails closed.

## Context
- Owner agent: `backend`.
- Read first: AGENTS.md; ADR-003 (identity) and ADR-006 (validation/errors) in docs/plan/03-decisions/; docs/plan/01-prd.md (error envelope and codes).
- Express 5 forwards rejected promises from handlers to error middleware, so don't add async wrappers.
- `express.json()` leaves `req.body` undefined when there is no JSON body, so call `parseBody(schema, req.body ?? {})`.

## Scope
- **In:**
  - `src/http/errors.ts`, `src/http/validate.ts`, `src/auth/identity.ts` (new)
  - `src/app.ts` (register `errorHandler` last)
  - package.json and lockfile (`zod@^4`)
  - `test/http/errors.test.ts`, `test/http/validate.test.ts`, `test/auth/identity.test.ts`
- **Out:** mounting identity or JSON parsing on any router (T-005), domain code, global 404 handler.

## Steps
1. Run `npm install zod@^4`.
2. `src/http/errors.ts`:
   - `export class HttpError extends Error { constructor(readonly status: number, readonly code: string, message: string, readonly details?: { path: string; message: string }[]) }`.
   - `export const errorHandler: ErrorRequestHandler`:
     - if headers are already sent, call `next(err)`;
     - `HttpError` → `res.status(status).json({ error: { code, message, details? } })`;
     - `err.type === "entity.parse.failed"` → 400 `invalid_json`;
     - `err.type === "entity.too.large"` → 413 `payload_too_large`;
     - otherwise `console.error(err)` and 500 `{ error: { code: "internal_error", message: "Internal server error" } }`.
3. `src/http/validate.ts`:
   - `export const emailSchema`: string, trimmed, lowercased, max 254, valid email (zod v4 API).
   - `export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T`. On failure, throw `HttpError(400, "validation_failed", "Request body is invalid", details)`, where each detail is `{ path: issue.path.join("."), message: issue.message }`.
4. `src/auth/identity.ts`:
   - `export interface AuthUser { email: string }`.
   - `export function requireUser(opts: { enabled: boolean }): RequestHandler`:
     - disabled → 401 `unauthenticated` "Authentication is not configured";
     - missing header → 401 "Missing X-User-Email header";
     - invalid → 401 "Invalid X-User-Email header";
     - otherwise set `res.locals.user = { email: normalized }` and call `next()`.
   - `export function currentUser(res: Response): AuthUser` throws a plain `Error` if the middleware didn't run (programming error, becomes a 500).
5. In `src/app.ts`, add `app.use(errorHandler)` as the last line before returning, with a comment: "routers must be mounted above this line".
6. Tests build small `express()` apps inline that mount the unit under test and `errorHandler`. Silence expected `console.error` with `vi.spyOn(console, "error").mockImplementation(() => {})`.

## Acceptance criteria
- [ ] Throwing `new HttpError(403, "forbidden", "Nope")` returns 403 with body `{ "error": { "code": "forbidden", "message": "Nope" } }`.
- [ ] A rejected async handler with `new Error("secret detail")` returns 500 `internal_error`. The response body doesn't contain `secret detail`, and `console.error` was called.
- [ ] Malformed JSON behind `express.json()` returns 400 `invalid_json`. A body over the 10 kB limit (`express.json({ limit: "10kb" })`) returns 413 `payload_too_large`.
- [ ] `parseBody` returns typed data on success. On failure it throws an `HttpError` with status 400, code `validation_failed`, and a non-empty `details` whose `path` names the bad field.
- [ ] `emailSchema` maps `"  Alice@Example.COM "` to `"alice@example.com"`, and rejects `"not-an-email"` and a 255-character address.
- [ ] `requireUser`: disabled → 401; missing header → 401; invalid header → 401; valid header → a downstream handler sees the normalized email via `currentUser(res)`. Every 401 body has code `unauthenticated`.
- [ ] `test/users.test.ts` passes unchanged. `src/routes/users.ts` is unchanged.
- [ ] The full gate passes.

## Verification
```sh
npx vitest run test/http/errors.test.ts test/http/validate.test.ts test/auth/identity.test.ts
npx vitest run test/users.test.ts
git diff --quiet -- src/routes/users.ts test/users.test.ts
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```
All commands exit 0.

## Risks and notes
- zod v4 changed some APIs (for example the top-level `z.email()`). Use the installed major version's documented API and note it here.
- Services will throw `HttpError` directly (ADR-006). Keep `HttpError` free of Express imports so `src/teams/*` can use it.
