<!-- bae:begin -->
# AGENTS.md — go-service

## Purpose
Internal HTTP service (Go + Gin) that other internal services call. It exposes `GET /health`, `POST /users` and `GET /users`. Users live in process memory only. Out of scope, so do not add them: databases or any persistence, and authentication or authorization.

## Current state (2026-09-26)
The repo is a stub. `main.go:6` calls `handler.Run()`, which does nothing (`internal/handler/handler.go:3`), and the only test calls it without checking anything (`internal/handler/handler_test.go:5`). The plan in `docs/plan/` builds the service in 5 tasks. Check task status (`/status`, or the `status:` frontmatter in `docs/plan/tasks/*.md`) to see which parts below exist yet. Items marked "(T-00X)" appear when that task is done.

## Stack
- Go. `go.mod:3` declares `go 1.23`; module `example.com/go-service` (`go.mod:1`).
- Gin v1.10.0 (`go.mod:5`), used for HTTP routing only.
- Standard library for everything else: `net/http` server, `log/slog`, `net/mail`, `testing` + `net/http/httptest`.
- staticcheck, run via `go run` with the version pinned in `scripts/check.sh` (T-001).
- GitHub Actions CI in `.github/workflows/ci.yml` (T-001).

## Commands (run from the repo root)
| Purpose | Command |
| --- | --- |
| Run locally | `go run .` (listens on `:$PORT`, default 8080) |
| Try it | `curl -s localhost:8080/health` |
| All quality gates (T-001) | `sh scripts/check.sh` |
| Gates + race detector (needs cgo and a C compiler; CI always does this) | `RACE=1 sh scripts/check.sh` |
| Tests only | `go test -count=1 ./...` |
| Format | `gofmt -w .` |
| Format check | `test -z "$(gofmt -l .)"` |
| Vet | `go vet ./...` |
| Module hygiene (T-002) | `go mod tidy -diff` |
| Build | `go build -o bin/go-service .` |

Before T-001 lands, use the separate commands above instead of `scripts/check.sh`.

## Configuration (environment variables only)
| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | TCP port, 1-65535. Anything else makes startup fail. |
| `GIN_MODE` | `release` (set by `main.go` when unset) | `debug`, `release` or `test`. Anything else makes startup fail. |

## Architecture map (target)
```text
main.go                      run(ctx, getenv): config, logger, store, router, http.Server with timeouts, graceful shutdown
main_test.go                 starts run() on a free port, checks /health, cancels, expects clean exit (T-002)
internal/handler/            HTTP layer (gin)
  handler.go                 Deps struct + NewRouter(Deps) *gin.Engine: middleware chain and route table
  health.go                  GET /health (T-002)
  users.go                   UserStore interface, GET/POST /users, request validation (T-004)
  errors.go                  writeError + error codes (T-002)
  middleware.go              request ID, slog request logger, JSON panic recovery (T-005)
internal/store/              storage; must not import gin or internal/handler (T-003)
  store.go                   User type, ErrEmailTaken
  memory.go                  Memory: RWMutex, slice in insertion order, set of emails
scripts/check.sh             the quality gate; CI runs exactly this (T-001)
.github/workflows/ci.yml     CI (T-001)
docs/api.md                  HTTP contract for calling teams (T-002, T-004, T-005)
docs/plan/                   plan, ADRs, tasks
```

## HTTP contract (summary; full version in docs/api.md and ADR-003)
- `GET /health` returns `200 {"status":"ok"}`.
- `POST /users` with `{"name","email"}` returns `201 {"id","name","email"}`. `id` is an opaque string. `email` is trimmed and lowercased, and must be unique ignoring case (`409 email_taken` otherwise).
- `GET /users` returns `200 {"users":[...]}` in creation order. The list is never `null`.
- Every error looks like `{"error":{"code":"snake_case","message":"..."}}`. Codes: `invalid_json`, `validation_failed`, `email_taken`, `payload_too_large`, `not_found`, `method_not_allowed`, `internal`.

## Conventions
1. Layering: handlers only talk to the `UserStore` interface declared in `internal/handler/users.go`. `internal/store` imports neither gin nor `internal/handler`.
2. Wiring happens only in `main.go` `run()`. No package-level mutable state apart from gin mode.
3. Build routers only through `handler.NewRouter(handler.Deps{...})`, in production and in tests.
4. Every non-2xx response goes through `writeError`. 5xx messages are generic; the details go to logs only.
5. JSON arrays are never `null`: build them with `make([]T, 0, n)`.
6. Store methods take `context.Context` first and return an `error`.
7. Tests use the standard `testing` and `httptest` packages, are table-driven, and use hand-written fakes in `_test.go` files. No testify or mock libraries. Handler package tests call `gin.SetMode(gin.TestMode)` in `TestMain`. Name tests `TestThing_Behavior`.
8. Code is gofmt-formatted. Imports are grouped as standard library, third-party, then this module.
9. Logging uses `log/slog` JSON through the logger in `Deps` (T-005). Never log request bodies, emails or query strings.
10. Dependencies are gin plus the standard library only. Adding a module needs an ADR in `docs/plan/03-decisions/`.
11. Code must compile under Go 1.23 rules. Do not use standard library APIs newer than 1.23 (for example, `slog.DiscardHandler` arrived in 1.24); `go vet` flags these.
12. Any change to HTTP behavior updates `docs/api.md` in the same task.
13. Write doc comments on exported identifiers. Other comments only explain non-obvious "why".

## Do
- Stay inside the task's Scope. If you must touch another file, say why in the task's "Risks and notes".
- Test the error paths, not only the happy path.
- Run `sh scripts/check.sh` before calling a task done.
- Write down any new assumption in the task's "Risks and notes".

## Don't
- Add a database, persistence files, authentication, or endpoints no task asks for.
- Run `go mod tidy` before T-002. Gin is not imported yet, so tidy would remove it from go.mod.
- Use `gin.Default()` or `engine.Run()`. `engine.Run()` has no timeouts and no graceful shutdown.
- Weaken, skip or delete tests or checks just to get a green run.
- Run `sudo`, `rm -rf`, `git reset --hard`, `git push`, or piped installers (`curl | sh`).
- Edit `.bae/`; it holds planning-tool state.

## Plan and workflow
- The plan lives in `docs/plan/`: `00-overview.md`, `01-prd.md`, `02-architecture.md`, `03-decisions/ADR-*.md`, `04-roadmap.md`, and `tasks/T-*.md`.
- Each task's status lives in its frontmatter: `pending`, `in_progress`, `done` or `blocked`. That frontmatter is the only source of truth.
- To pick the next task: if one is `in_progress`, resume it. Otherwise take the lowest-numbered `pending` task whose `depends_on` tasks are all `done`. T-002 and T-003 can run in parallel.
- Per task: set `in_progress`, read its Context files, implement, run every Verification command (each must exit 0), get it reviewed against its acceptance criteria, then set `done`.
- If blocked: set `blocked`, put the reason under "Risks and notes", and stop.
- Commit locally once per task. Stage only the files you changed plus the task file, never `.bae/`. Use Conventional Commits with the task id, for example `feat(users): add POST/GET /users handlers (T-004)`. Never push.
- If `docs/plan/`, `AGENTS.md`, `CLAUDE.md`, `.claude/` or `.opencode/` are still untracked, commit them first as a separate `docs(plan): add implementation plan and agent config` commit.

## Definition of done (every task)
- Every acceptance criterion is met, with evidence (a file:line or command output).
- Every Verification command exits 0, and `sh scripts/check.sh` passes.
- Changed files stay within the task's Scope; `docs/api.md` is updated if HTTP behavior changed.
- No new dependencies, and nothing that is out of scope.
<!-- bae:end -->
