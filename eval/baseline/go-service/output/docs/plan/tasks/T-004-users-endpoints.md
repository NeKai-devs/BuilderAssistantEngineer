---
id: T-004
title: Add POST /users and GET /users handlers backed by the store
status: pending
phase: 2
depends_on: [T-002, T-003]
size: M
risk: medium
---
## Goal
Other services can create users with `POST /users` and list them with `GET /users`, exactly as ADR-003 specifies. The handlers are fully tested with `httptest`, and `docs/api.md` documents them. This is the first deliverable.

## Context
- Read `AGENTS.md`, `docs/plan/03-decisions/ADR-003-http-api-contract.md` and `ADR-002-in-memory-user-store.md`.
- Files from earlier tasks:
  - `internal/handler/handler.go`: `Deps`, `NewRouter` (T-002)
  - `internal/handler/errors.go`: `writeError` (T-002)
  - `internal/store/store.go` and `internal/store/memory.go` (T-003)
  - `main.go`: `run()` (T-002)
- Gotchas:
  - a nil slice serializes as `null`, so build response lists with `make`;
  - `json.Decoder` returns `*http.MaxBytesError` when `MaxBytesReader` hits its limit; check it with `errors.As`;
  - don't use gin binding tags (ADR-003);
  - `slog.Default()` is enough for logging 500s here; T-005 moves this to the injected logger.

## Scope
- In:
  - `internal/handler/users.go` (new)
  - `internal/handler/users_test.go` (new)
  - `internal/handler/handler.go` (add `Deps.Users` and the routes)
  - `internal/handler/errors.go` (new codes)
  - `internal/handler/handler_test.go` (pass `Deps{Users: store.NewMemory()}`)
  - `main.go` (connect `store.NewMemory()`)
  - `main_test.go` (only if the `Deps` change requires it)
  - `docs/api.md`
- Out: `GET /users/{id}`, pagination, update or delete, auth, request IDs (T-005).

## Steps
1. `users.go`:
   - `type UserStore interface { Create(ctx context.Context, name, email string) (store.User, error); List(ctx context.Context) ([]store.User, error) }`.
   - Add `Users UserStore` to `Deps`. `NewRouter` panics with a clear message if `deps.Users == nil`, so a wiring mistake fails at startup.
2. Types:
   - `createUserRequest{Name string \`json:"name"\`; Email string \`json:"email"\`}`;
   - `userResponse{ID, Name, Email}` with JSON tags `id`, `name`, `email`;
   - `listUsersResponse{Users []userResponse \`json:"users"\`}`.
3. `POST /users`, in this order:
   - wrap the body: `c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)`;
   - decode with `json.NewDecoder`:
     - `*http.MaxBytesError` → `413 payload_too_large`;
     - any other error, including an empty body, → `400 invalid_json`;
   - trim both fields, then validate:
     - name must be 1-100 runes (`utf8.RuneCountInString`);
     - email must be 1-254 bytes, `mail.ParseAddress(email)` must succeed, and `addr.Address == email`;
     - on failure, return `400 validation_failed` with a message such as `"name is required"`, `"name must be at most 100 characters"` or `"email is invalid"`;
   - call `deps.Users.Create(c.Request.Context(), name, email)`:
     - `ErrEmailTaken` → `409 email_taken`;
     - any other error → log with `slog.ErrorContext` and return `500 internal` with the generic message `"internal server error"`;
     - success → `201` with a `userResponse`.
4. `GET /users`: call `List`. An error gives 500 as above. Otherwise return `200 listUsersResponse`, with the list built by `make([]userResponse, 0, len(users))`.
5. Add the error codes `invalid_json`, `validation_failed`, `email_taken` and `payload_too_large` to `errors.go`.
6. `main.go`: `handler.NewRouter(handler.Deps{Users: store.NewMemory()})`.
7. Tests in `users_test.go` (table-driven, `httptest`, with a hand-written `failingStore` fake):
   - `TestCreateUser` covers:
     - valid input → 201 with `{"id":"1","name":"Ada","email":"ada@example.com"}` from input `"Ada@Example.com"`, and a JSON content type;
     - malformed JSON, empty body, or a JSON array → 400 `invalid_json`;
     - missing or blank name, a 101-rune name, missing email, `not-an-email`, or `Bob <b@x.io>` → 400 `validation_failed`;
     - a duplicate differing only in case → 409 `email_taken`;
     - a body over 1 MiB → 413 `payload_too_large`;
     - `failingStore` → 500 `internal`, and the body does not contain the fake's error text;
     - unknown extra fields → 201.
   - `TestListUsers` covers:
     - an empty store gives the exact body `{"users":[]}`;
     - after two creates, the list has both, in order;
     - `failingStore` → 500 `internal`.
8. `docs/api.md`: document `POST /users` and `GET /users`, with the request and response schemas, validation rules, email normalization, every status and error code, curl examples, and a note that data is in memory, lost on restart, and that IDs are opaque strings.

## Acceptance criteria
- [ ] `POST /users` and `GET /users` behave exactly as ADR-003 and FR-2 to FR-6 in `01-prd.md` describe, and every row of the ADR-003 error table that applies to `/users` has a test.
- [ ] `GET /users` with no users returns exactly `{"users":[]}`.
- [ ] 500 responses never include the underlying error text.
- [ ] Handlers use only the `UserStore` interface, and `main.go` connects `store.NewMemory()`.
- [ ] `NewRouter` panics when `Deps.Users` is nil, and a test covers this.
- [ ] `docs/api.md` documents both endpoints and every error code they can return.
- [ ] `sh scripts/check.sh` passes, including `go mod tidy -diff` (no new modules).

## Verification
```sh
sh scripts/check.sh
go test -count=1 ./internal/handler/ .
grep -q 'func TestCreateUser' internal/handler/users_test.go
grep -q 'func TestListUsers' internal/handler/users_test.go
grep -q 'store.NewMemory()' main.go
grep -q 'email_taken' docs/api.md
grep -q 'payload_too_large' docs/api.md
grep -q 'POST /users' docs/api.md
```
Every command exits 0. Manual demo: `go run .`, then:
- `curl -i -X POST localhost:8080/users -d '{"name":"Ada","email":"Ada@Example.com"}'` → 201;
- `curl -s localhost:8080/users` → one user listed;
- the same POST again → 409 `email_taken`.

## Risks and notes
- The user fields are provisional (Q1). If they change, update ADR-003, ADR-002, `store.User`, the types here and `docs/api.md` together.
- `net/mail` accepts addresses without a top-level domain (`a@b`). That is intended; we don't try to check deliverability.
