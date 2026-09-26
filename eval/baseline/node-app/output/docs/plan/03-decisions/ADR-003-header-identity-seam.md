# ADR-003: Request identity via an `X-User-Email` header, off in production by default

- Status: Accepted (provisional, pending Q1)
- Date: 2026-09-26

## Context
Owner-only invites and email-bound acceptance require knowing who is calling. The codebase has no authentication (src/ contains only src/index.ts, src/cli.ts, src/routes/users.ts). SSO is out of scope. Building full auth (signup, credentials, sessions) was not requested.

## Decision
- `src/auth/identity.ts` exports `requireUser({ enabled })`. It reads `X-User-Email`, validates it with `emailSchema`, normalizes it (trim + lowercase), and sets `res.locals.user = { email }`. `currentUser(res)` returns the typed `AuthUser`.
- It is applied **only** to the `/teams` and `/invites` routers. `/users` is untouched.
- `enabled` comes from `resolveHeaderIdentityEnabled(env)`: true when `NODE_ENV !== "production"` or `ALLOW_HEADER_IDENTITY === "true"`. When disabled, every request to the new routes gets `401 unauthenticated`.
- `src/index.ts` logs at startup whether header identity is enabled.
- Services depend only on `AuthUser { email }`. Replacing the middleware later (for example with JWT verification) doesn't touch services or stores.

## Alternatives
- **API keys or passwords in this service:** real security, but adds signup, credential hashing and token lifecycle, which is far beyond the brief.
- **Verify JWTs from an upstream identity provider:** the right next step. It needs a provider decision (Q1), and SSO is out of scope.
- **Take the actor's email from the request body:** can't enforce owner-only actions. Rejected.

## Consequences
- **The header is spoofable.** Header identity is only acceptable locally, in tests, or behind a trusted gateway that sets the header and strips it from client traffic (`ALLOW_HEADER_IDENTITY=true`).
- The invite token remains the proof of email ownership during acceptance.
- In production without opt-in, the teams features are unavailable, but existing routes keep working.
