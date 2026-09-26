# Architecture

## Current state (evidence)
| Item | Evidence | Notes |
| --- | --- | --- |
| Entry point | `main.go:1-7` | `package main` imports `example.com/go-service/internal/handler` and calls `handler.Run()`. |
| Handler package | `internal/handler/handler.go:1-3` | `func Run() {}` does nothing, so there is no HTTP server yet. |
| Tests | `internal/handler/handler_test.go:1-5` | `TestRun` calls `Run()` and checks nothing. Once `Run` serves HTTP, this test would hang. |
| Module | `go.mod:1-5` | `module example.com/go-service`, `go 1.23`, `require github.com/gin-gonic/gin v1.10.0`. |
| Dependency state | repo tree | No `go.sum`, and no Go file imports gin. Running `go mod tidy` now would remove the gin requirement. |
| Ignore rules | `.gitignore:1-2` | Ignores `.bae/runs/` and `.bae/tmp/` only. |
| Tooling | repo tree | No lint config, Makefile, CI workflow, Dockerfile, README or docs. |
| Git | `.git/config:1-5` | No remote configured. `.gitignore` and `.bae/` are untracked. |

There is no data model, no configuration and no logging yet. Security posture: nothing is exposed today.

## Target state
```text
            other internal services
                      │  HTTP/JSON, trusted network, no auth
                      ▼
main.go  run(ctx, getenv) error
  ├─ config: PORT (default 8080), GIN_MODE (default release)   — validated, fail fast
  ├─ logger: slog JSON → stdout                                (T-005)
  ├─ users := store.NewMemory()                                (T-004)
  ├─ router := handler.NewRouter(handler.Deps{Users, Logger})
  └─ http.Server{ReadHeaderTimeout 5s, ReadTimeout 10s, WriteTimeout 10s, IdleTimeout 60s}
       graceful Shutdown (10s) when ctx is cancelled by SIGINT/SIGTERM

internal/handler  (gin)
  middleware: requestID → requestLogger → JSON recovery        (T-005; T-002 uses gin.Recovery + gin.Logger)
  routes:     GET /health · GET /users · POST /users
  fallbacks:  NoRoute → 404 not_found · NoMethod → 405 method_not_allowed
  UserStore interface (defined here, where it is used) ──► internal/store.Memory

internal/store  (stdlib only)
  Memory{mu sync.RWMutex; nextID int64; users []User; emails map[string]struct{}}
```

### Request flow: POST /users
1. `http.MaxBytesReader` caps the body at 1 MiB; going over gives 413.
2. `json.Decoder` decodes the body; a decode error gives `400 invalid_json`.
3. Trim, then validate name and email; a failure gives `400 validation_failed`.
4. `UserStore.Create(ctx, name, email)`. `ErrEmailTaken` gives 409; any other error gives 500 `internal` and is logged.
5. Map the result to a response type and return 201.

### Data model
`store.User{ID, Name, Email string}`. The handler has its own request and response types, so the store's type can change without changing the API. IDs are consecutive decimal strings and are opaque in the contract (ADR-002).

### Concurrency
`Memory` uses one `sync.RWMutex`. `Create` checks the email and inserts under the write lock, so it is atomic. `List` copies the slice under the read lock. An ID is used up only when a create succeeds.

### Error handling
One helper, `writeError(c, status, code, message)`. Error codes are fixed in ADR-003. 5xx responses return a generic message, and the details go to logs.

### Observability
- T-002: `gin.Logger()`, as text on stdout.
- T-005: one slog JSON line per request with `method`, `path`, `route`, `status`, `latency_ms`, `request_id` and `client_ip`. Panics are logged at ERROR level. No bodies, emails or query strings. Metrics and tracing are deferred.

### Security posture
- No auth by design (A-4), so the service must only be reachable on the internal network. `docs/api.md` says so.
- Server timeouts guard against slow clients, and the 1 MiB body cap guards against memory exhaustion.
- `SetTrustedProxies(nil)` stops callers from faking `ClientIP` through `X-Forwarded-For`.
- Emails are PII. They are held only in memory and never logged.
- Known gap: nothing limits how many users can be created. This is acceptable for an internal MVP; see Risks.

### Testing strategy
- `internal/store`: unit tests, including concurrent creates (race detector in CI).
- `internal/handler`: table-driven `httptest` tests through `NewRouter`, with a fake store for failure paths.
- `main`: `run()` started on a free port, `/health` polled, context cancelled, clean return checked.
- Quality gate: `scripts/check.sh` (ADR-004).

## Migration path
| Step | Task | Change | Reversible |
| --- | --- | --- | --- |
| 1 | T-001 | Add `scripts/check.sh`, CI workflow and `bin/` in `.gitignore`. Download gin into `go.sum` only if needed. | yes |
| 2 | T-002 | Remove `handler.Run`. Add `NewRouter`, `/health`, the error helper and `main.go run()`. Replace `TestRun`. Run `go mod tidy`. Add `docs/api.md`. | yes |
| 3 | T-003 | Add `internal/store` (not used by anything yet). | yes |
| 4 | T-004 | Add the `/users` handlers and connect `store.NewMemory()` in `main.go`. | yes |
| 5 | T-005 | Replace `gin.Logger()`/`gin.Recovery()` with slog middleware and add request IDs. | yes |

No step rewrites existing behavior, because the only existing behavior is a function that does nothing.

## Debt and risks
- `go 1.23` (`go.mod:3`) is no longer supported upstream. CI builds with the latest stable Go, and `go vet` catches standard library APIs newer than 1.23.
- gin v1.10.0 is not the newest release; upgrading is out of scope.
- Paths are unversioned (`/users`, as the brief specifies). A breaking change later would need a new path.
- The in-memory store: data is lost on restart, is not shared between copies, and has no size limit.
