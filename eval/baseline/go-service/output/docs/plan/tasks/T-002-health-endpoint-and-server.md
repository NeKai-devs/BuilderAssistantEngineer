---
id: T-002
title: Serve GET /health from a Gin router with graceful shutdown
status: pending
phase: 1
depends_on: [T-001]
size: M
risk: medium
---
## Goal
`go run .` starts a real HTTP server on `$PORT` (default 8080) with these behaviors:
- `GET /health` returns `200 {"status":"ok"}`;
- unknown routes and methods get JSON 404 and 405 errors;
- SIGINT or SIGTERM shuts it down gracefully.

This replaces the stub, makes the service runnable, and sets up the router, error helper and server lifecycle that later tasks build on.

## Context
- Current code:
  - `main.go:5-7` calls `handler.Run()`;
  - `internal/handler/handler.go:3` defines `Run` as a no-op;
  - `internal/handler/handler_test.go:5` calls `Run()`. Remove that test: it tests nothing, and would hang once the server blocks.
- Read `docs/plan/03-decisions/ADR-001-package-layout.md` (layout, `run()`), `ADR-003-http-api-contract.md` (error envelope, 404/405) and AGENTS.md Conventions.
- Gin v1.10.0 is already required (`go.mod:5`). After importing it, run `go mod tidy` to write a full `go.sum`.
- Gin details:
  - use `gin.New()`, not `gin.Default()`, then add `gin.Recovery()` and `gin.Logger()` (T-005 replaces both);
  - call `r.SetTrustedProxies(nil)`;
  - set `r.HandleMethodNotAllowed = true`;
  - `gin.SetMode` panics on an unknown value, so validate `GIN_MODE` first.

## Scope
- In:
  - `main.go`
  - `main_test.go` (new)
  - `internal/handler/handler.go` (rewrite)
  - `internal/handler/health.go` (new)
  - `internal/handler/errors.go` (new)
  - `internal/handler/handler_test.go` (rewrite)
  - `docs/api.md` (new)
  - `go.sum`
  - `scripts/check.sh` (add the tidy check)
- Out: `/users`, request IDs and structured logging (T-005), Dockerfile.

## Steps
1. `internal/handler/errors.go`:
   - `func writeError(c *gin.Context, status int, code, message string)`, which writes `{"error":{"code":code,"message":message}}` and aborts the request;
   - constants `codeNotFound = "not_found"`, `codeMethodNotAllowed = "method_not_allowed"`, `codeInternal = "internal"`.
2. `internal/handler/handler.go`:
   - package doc comment;
   - `type Deps struct{}`, documented as "dependencies for NewRouter" (later tasks add fields);
   - `func NewRouter(deps Deps) *gin.Engine`, which sets up the middleware and settings from Context, registers `GET /health`, and sets `NoRoute` to 404 `not_found` and `NoMethod` to 405 `method_not_allowed`.
3. `internal/handler/health.go`: `c.JSON(http.StatusOK, gin.H{"status": "ok"})`.
4. `main.go`:
   - `main()` does `ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)`, then `run(ctx, os.Getenv)`; on error it logs and calls `os.Exit(1)`.
   - `run` does the following:
     - reads `PORT` (default `"8080"`) and returns an error unless it is an integer in 1-65535;
     - reads `GIN_MODE` (default `gin.ReleaseMode`), returns an error unless it is `debug`, `release` or `test`, then calls `gin.SetMode`;
     - builds `http.Server{Addr: ":" + port, Handler: handler.NewRouter(handler.Deps{}), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}`;
     - calls `ListenAndServe` in a goroutine;
     - when `ctx.Done()` fires, calls `Shutdown` with a 10 s timeout;
     - returns nil on a clean stop (treating `http.ErrServerClosed` as success), and returns listen errors straight away.
5. Tests, in `package handler`:
   - `handler_test.go`: `TestMain` calls `gin.SetMode(gin.TestMode)`.
   - `TestHealth`: 200, body exactly `{"status":"ok"}`, `Content-Type` starts with `application/json`.
   - `TestNotFound`: `GET /nope` gives 404 with `error.code == "not_found"`.
   - `TestMethodNotAllowed`: `POST /health` gives 405 with `error.code == "method_not_allowed"`.
6. `main_test.go`:
   - `TestRun_ServesAndShutsDown`: take a free port (`net.Listen("tcp", "127.0.0.1:0")`, read the port, close it), start `run` in a goroutine with a stubbed `getenv` and a cancellable ctx, and poll `http://127.0.0.1:<port>/health` for up to 5 s until it returns 200. Then cancel and assert `run` returns nil within 5 s.
   - `TestRun_InvalidConfig`: table of `PORT` values `abc`, `0`, `70000` and `GIN_MODE=bogus`; `run` returns an error.
7. `docs/api.md`, written for calling teams:
   - base URL and `PORT`;
   - JSON conventions and the error envelope with its code table (from ADR-003);
   - a warning: no authentication, internal network only;
   - `GET /health` with a curl example.
8. Run `go mod tidy`. Then add `go mod tidy -diff` to `scripts/check.sh`, right after the gofmt check.

## Acceptance criteria
- [ ] `handler.Run` no longer exists, and `main.go` calls `run(ctx, os.Getenv)`.
- [ ] Tests prove `GET /health` returns 200 with body exactly `{"status":"ok"}` and a JSON content type.
- [ ] Tests prove an unknown path gets 404 `not_found` and `POST /health` gets 405 `method_not_allowed`, both in the error envelope.
- [ ] `TestRun_ServesAndShutsDown` passes: the server answers on `PORT`, and `run` returns nil within 5 s after cancel.
- [ ] Invalid `PORT` (`abc`, `0`, `70000`) and invalid `GIN_MODE` make `run` return an error without panicking.
- [ ] The `http.Server` sets `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout` and `IdleTimeout`.
- [ ] `go.sum` exists, `go mod tidy -diff` shows nothing, and `scripts/check.sh` runs `go mod tidy -diff`.
- [ ] `docs/api.md` documents `/health`, the error envelope and the no-auth warning.
- [ ] `sh scripts/check.sh` passes.

## Verification
```sh
sh scripts/check.sh
go test -count=1 ./internal/handler/ .
go mod tidy -diff
grep -q 'tidy -diff' scripts/check.sh
! grep -rq 'func Run()' internal/handler
grep -q 'func TestRun_ServesAndShutsDown' main_test.go
grep -q 'func TestRun_InvalidConfig' main_test.go
grep -q 'func TestHealth' internal/handler/handler_test.go
grep -q 'ReadHeaderTimeout' main.go
test -f go.sum
test -f docs/api.md
```
Every command exits 0. Manual demo: `go run .`, then in another shell run `curl -i localhost:8080/health` (expect 200 and `{"status":"ok"}`) and `curl -i -X POST localhost:8080/health` (expect 405 JSON). Press Ctrl-C; the process exits with code 0.

## Risks and notes
- Picking a free port and then closing it leaves a small race window. Accepted; retry once if it flakes.
- `gin.SetMode` changes global state. Tests that call `run` must not run in parallel with handler tests that rely on test mode; they are in different packages, so this holds.
