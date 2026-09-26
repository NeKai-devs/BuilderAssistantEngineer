# PRD — go-service

## Problem
Other internal services need a small HTTP service to create and list users, and a health endpoint to check it is alive. Today the repo only has a stub (`internal/handler/handler.go:3`).

## Users
- **Primary:** engineers on other internal teams whose services call this one over HTTP/JSON.
- **Secondary:** whoever runs the service; they use `/health` and the logs.

## Goals
- G1: a working HTTP service with `GET /health`, `POST /users` and `GET /users`.
- G2: automated tests for every endpoint, covering error paths as well as the happy path.
- G3: a written HTTP contract (`docs/api.md`) that calling teams can code against.
- G4: quality gates run locally and in CI.

## Non-goals (explicitly out of scope)
- A database or any other persistence. Data lives in memory and is lost on restart.
- Authentication and authorization.
- `GET/PUT/PATCH/DELETE /users/{id}`, and pagination or filtering on `GET /users`. Deferred; see Q2.
- Consistency across several copies of the service.
- Dockerfile or deployment manifests, metrics, tracing, rate limiting.

## Functional requirements
| ID | Requirement |
| --- | --- |
| FR-1 | `GET /health` returns `200` with `{"status":"ok"}`. It checks nothing else, because there are no dependencies to check. |
| FR-2 | `POST /users` takes `{"name": string, "email": string}` and returns `201` with `{"id": string, "name": string, "email": string}`. |
| FR-3 | Name is trimmed and must be 1-100 characters (runes). Email is trimmed, at most 254 bytes, and must be a bare RFC 5322 address (`net/mail`). Invalid input gets `400 validation_failed`, with a message naming the field. |
| FR-4 | Email is stored lowercased and must be unique ignoring case. A duplicate gets `409 email_taken`. |
| FR-5 | Malformed or empty JSON gets `400 invalid_json`. A body over 1 MiB gets `413 payload_too_large`. Unknown JSON fields are ignored. |
| FR-6 | `GET /users` returns `200` with `{"users":[...]}` in creation order. With no users it returns `{"users":[]}`. |
| FR-7 | Unknown paths get `404 not_found`, and unsupported methods on known paths get `405 method_not_allowed`. Both use the JSON error envelope. |
| FR-8 | All errors use `{"error":{"code","message"}}`. 5xx messages never reveal internal details. |
| FR-9 (phase 3) | Every response carries `X-Request-ID`. A valid incoming ID is kept; otherwise a new one is generated. |

## Non-functional requirements
| ID | Requirement |
| --- | --- |
| NFR-1 | Store operations are safe under concurrent requests. CI runs the tests with `-race`. |
| NFR-2 | On SIGINT or SIGTERM the server stops gracefully, draining for at most 10 s. |
| NFR-3 | The server sets read, header, write and idle timeouts (defends against slowloris-style attacks). |
| NFR-4 | Configuration comes only from environment variables (`PORT`, `GIN_MODE`), and invalid values fail at startup. |
| NFR-5 | Logs are JSON on stdout, one line per request, and contain no request bodies, emails or query strings (phase 3). |
| NFR-6 | `sh scripts/check.sh` passes locally and in CI on every change. |
| NFR-7 | The only dependencies are gin and the standard library. |

## Success criteria
- The phase 2 demo works: create a user with curl, list it, and get a 409 on a duplicate.
- Every requirement FR-1 to FR-8 is covered by at least one test (`go test ./...`).
- `docs/api.md` documents every endpoint, status code and error code.
- CI passes on the default branch.

## Assumptions
- A-1: a user is `{id, name, email}`; email is required and unique ignoring case (Q1).
- A-2: IDs are opaque strings. The MVP numbers them `"1"`, `"2"`, … and IDs restart after a reboot.
- A-3: one instance runs at a time, and losing data on restart is acceptable.
- A-4: callers sit on a trusted internal network. There is no auth, and TLS is terminated outside the process.
- A-5: CI runs on GitHub Actions (there is no git remote, Q3).
- A-6: the port comes from `PORT`, default 8080.
- A-7: developer machines have Go ≥ 1.23 and network access to the Go module proxy (for gin, staticcheck and actionlint).
- A-8: the user count stays small (thousands at most), so listing everything without pagination is fine.
- A-9: CI runners have a C compiler for `-race` (GitHub's `ubuntu-latest` does). Locally it is optional.
- A-10: gin stays at v1.10.0 (`go.mod:5`), and the Go version in go.mod stays at 1.23 (Q4).

## Open questions
See the QUESTIONS block from the planning run. The questions cover: user fields and uniqueness (Q1), GET /users/{id} and pagination (Q2), where CI runs (Q3), the Go version (Q4), and deployment and number of copies (Q5).
