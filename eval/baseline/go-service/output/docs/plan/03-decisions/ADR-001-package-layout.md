# ADR-001: Package layout and wiring

- Status: Accepted
- Date: 2026-09-26

## Context
`main.go:6` calls `handler.Run()`, and `internal/handler/handler.go:3` defines it as a no-op. We need a router that tests can drive without opening a network port, server startup and shutdown that can be tested (timeouts, graceful shutdown), and somewhere to put storage that could later be replaced by a database (not in scope now).

## Decision
- `internal/handler` owns the HTTP layer:
  - `type Deps struct{...}` and `func NewRouter(deps Deps) *gin.Engine`,
  - the handlers, the middleware and `writeError`,
  - the `UserStore` interface, defined in the package that uses it.
- `internal/store` owns storage (`Memory`, `User`, `ErrEmailTaken`). It uses the standard library only.
- `main.go` owns the process:
  - `func run(ctx context.Context, getenv func(string) string) error` reads config, wires dependencies, runs `http.Server` with timeouts, and shuts down gracefully when `ctx` is cancelled;
  - `main()` creates `ctx` with `signal.NotifyContext` and exits 1 if `run` returns an error.
- `handler.Run` is removed, and `TestRun` (`internal/handler/handler_test.go:5`) is replaced.
- The gin engine is passed to `net/http.Server` as its `Handler`. `engine.Run()` is never used.

## Alternatives considered
- **Keep `handler.Run()` doing everything.** Rejected: a blocking function that is hard to test, and it mixes wiring with HTTP code.
- **`cmd/go-service/` plus an `internal/server` package.** Rejected for now: too much structure for about 10 files. Easy to move to later.
- **A `pkg/` layout.** Rejected: this module has nothing to export.
- **`gin.Default()` and `engine.Run()`.** Rejected: no server timeouts, no graceful shutdown, and a text logger we can't configure.

## Consequences
- `main.go` grows by about 50 lines. It stays the only place where things are wired together.
- Handler tests build the router through `NewRouter`, the same way production does.
- A persistent store later is just another type in `internal/store` that satisfies `UserStore`; handlers don't change.
