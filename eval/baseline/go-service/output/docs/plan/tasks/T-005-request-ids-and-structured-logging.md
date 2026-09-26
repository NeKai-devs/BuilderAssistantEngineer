---
id: T-005
title: Add request IDs and structured JSON request logging with slog
status: pending
phase: 3
depends_on: [T-004]
size: S
risk: low
---
## Goal
Every request gets these behaviors:
- an `X-Request-ID`, kept from the caller if valid, otherwise generated;
- exactly one JSON log line;
- if a handler panics, a JSON 500 response in the error envelope and an ERROR log line.

Calling teams can then match their failures to our logs.

## Context
- Read `AGENTS.md` and `docs/plan/03-decisions/ADR-005-structured-logging-and-request-ids.md`.
- Current code:
  - `internal/handler/handler.go`: `NewRouter` uses `gin.Recovery()` and `gin.Logger()` (T-002);
  - `internal/handler/users.go`: logs 500s with `slog.Default()` (T-004);
  - `main.go`: `run()`.
- Gotchas:
  - `slog.DiscardHandler` needs Go 1.24, so use `slog.New(slog.NewTextHandler(io.Discard, nil))` as the nil fallback;
  - `c.FullPath()` is `""` for unmatched routes;
  - register middleware before routes, and put recovery after the logger so panics are logged with status 500.

## Scope
- In:
  - `internal/handler/middleware.go` (new)
  - `internal/handler/middleware_test.go` (new)
  - `internal/handler/handler.go` (add `Deps.Logger`, the middleware chain)
  - `internal/handler/users.go` (use the injected logger)
  - `main.go` (JSON logger; startup and shutdown log lines)
  - `docs/api.md` (`X-Request-ID`)
- Out: metrics, tracing, log shipping, access control.

## Steps
1. Add `Logger *slog.Logger` to `Deps`. A nil value falls back to a discard logger.
2. `requestID()` middleware:
   - accept an incoming `X-Request-ID` if it matches `^[A-Za-z0-9._-]{1,128}$`;
   - otherwise generate `hex.EncodeToString` of 16 bytes from `crypto/rand`;
   - `c.Set("request_id", id)` and `c.Header("X-Request-ID", id)`.
3. `requestLogger(logger)` middleware:
   - after `c.Next()`, write `logger.LogAttrs(ctx, level, "http_request", ...)` with `method`, `path` (`c.Request.URL.Path`), `route` (`c.FullPath()`), `status`, `latency_ms`, `request_id` and `client_ip`;
   - level is ERROR if the status is ≥ 500, otherwise INFO;
   - never log bodies, emails or query strings.
4. Recovery: `gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, err any) { ... })`. It logs `panic` at ERROR with `request_id` and `error`, then calls `writeError(c, 500, codeInternal, "internal server error")`.
5. Middleware order in `NewRouter`: `requestID`, then `requestLogger`, then recovery. Remove `gin.Logger()` and `gin.Recovery()`. `users.go` logs 500s through `deps.Logger`, including the `request_id`.
6. `main.go`:
   - `logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))`, passed in `Deps`;
   - log `server starting` with `addr` and `server stopped`;
   - log `main()` errors through the same logger.
7. Tests in `middleware_test.go`, with the logger writing JSON into a `bytes.Buffer`:
   - `TestRequestID_Generated`: with no header, the response header matches `^[0-9a-f]{32}$`.
   - `TestRequestID_Propagated`: `abc-123` is echoed back.
   - `TestRequestID_InvalidReplaced`: `bad id` and a 200-character value are replaced.
   - `TestRequestLogger_Fields`: `GET /health` produces one JSON line with `status=200`, `method=GET`, `path=/health`, `route=/health`, and a `request_id` equal to the response header.
   - `TestRequestLogger_NoEmail`: the log output of `POST /users` does not contain the email.
   - `TestRecovery_JSON500`: register `GET /panic` on the engine `NewRouter` returns, have it panic, and expect 500 with `error.code == "internal"` and an ERROR log line.
8. `docs/api.md`: document the `X-Request-ID` behavior.

## Acceptance criteria
- [ ] Every response has `X-Request-ID`. A valid incoming value is kept; an invalid or missing one is replaced by 32 lowercase hex characters.
- [ ] Each request produces exactly one JSON log line with the ADR-005 fields; 5xx lines are at ERROR level.
- [ ] A panic produces a 500 in the JSON envelope and an ERROR log line with `request_id`.
- [ ] No log line contains request bodies, emails or query strings (tested for `POST /users`).
- [ ] `gin.Logger()` and `gin.Recovery()` are no longer used.
- [ ] `docs/api.md` documents `X-Request-ID`.
- [ ] `sh scripts/check.sh` passes.

## Verification
```sh
sh scripts/check.sh
go test -count=1 ./internal/handler/ .
grep -q 'func TestRequestID_Propagated' internal/handler/middleware_test.go
grep -q 'func TestRecovery_JSON500' internal/handler/middleware_test.go
grep -q 'func TestRequestLogger_NoEmail' internal/handler/middleware_test.go
! grep -q 'gin.Logger()' internal/handler/handler.go
! grep -q 'gin.Recovery()' internal/handler/handler.go
grep -q 'X-Request-ID' docs/api.md
```
Every command exits 0. Manual demo: `go run .`, then `curl -i -H 'X-Request-ID: abc-123' localhost:8080/health`. The response echoes `abc-123`, and stdout shows one JSON line with `"request_id":"abc-123"`.

## Risks and notes
- `latency_ms` differs from run to run, so tests only check that it exists and is ≥ 0.
- `client_ip` relies on `SetTrustedProxies(nil)` from T-002. Behind a load balancer it will show the proxy's IP. That's acceptable until deployment is known (Q5).
