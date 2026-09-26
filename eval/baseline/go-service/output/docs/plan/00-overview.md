# go-service — plan overview

## Goal
Build an internal Gin HTTP service that other services call:
- `GET /health` for liveness.
- `POST /users` to create users and `GET /users` to list them, stored in memory.

The first deliverable is both endpoints with tests. A database and authentication are out of scope.

## Starting point (evidence)
- `main.go:6` calls `handler.Run()`, which does nothing (`internal/handler/handler.go:3`).
- The only test, `internal/handler/handler_test.go:5`, calls `Run()` and checks nothing.
- `go.mod:5` requires gin v1.10.0, but no Go file imports it, and there is no `go.sum`.
- There is no lint config, CI, README or docs, and no git remote (`.git/config` has only `[core]`).
- History is a single commit, `b60da6d chore: initial state`.

## Approach
- Keep `internal/handler`. Add `internal/store` for the in-memory store. Move server startup and shutdown into `main.go` `run()` (ADR-001).
- Keep users in memory: a mutex-protected slice plus a set of emails, with opaque string IDs (ADR-002).
- Pin the HTTP contract down explicitly, with one error envelope and one list envelope (ADR-003).
- One quality gate, `scripts/check.sh` (gofmt, `go mod tidy -diff`, vet, staticcheck, tests), shared by local runs and GitHub Actions (ADR-004).
- Request IDs and JSON request logs with `log/slog` (ADR-005).
- Build in vertical slices: each phase ends with something you can try with curl and that is fully tested.

## Phases
| Phase | Outcome | Tasks | Demo |
| --- | --- | --- | --- |
| 1 | Quality baseline, and /health served by a real server | T-001, T-002 | `go run .` then `curl -i localhost:8080/health` gives `200 {"status":"ok"}`; `sh scripts/check.sh` passes |
| 2 | Users API (the first deliverable) | T-003, T-004 | `POST /users` returns 201, `GET /users` lists the user, a duplicate email returns 409 |
| 3 | Operability | T-005 | each request prints one JSON log line; `X-Request-ID` is generated or passed through |

5 tasks in total. The dependency graph and task index are in `04-roadmap.md`.

## Documents
- `01-prd.md`: requirements, what is out of scope, assumptions, success criteria
- `02-architecture.md`: current state with evidence, target state, migration path
- `03-decisions/`: ADR-001 to ADR-005
- `04-roadmap.md`: phases, graph, task index, deferred work
- `tasks/T-00X-*.md`: one task file per agent session

## Top risks
1. The user contract ({id, name, email}, unique email) is an assumption, and changing it after other teams integrate breaks them. Confirm it before T-003.
2. The in-memory store loses everything on restart, is not shared between copies of the service, and has no size limit. Run a single instance and say so in `docs/api.md`.
3. Tooling: `go 1.23` (`go.mod:3`) is no longer supported upstream. staticcheck needs a version pin that works with the installed Go, and every step needs network access to fetch modules.
