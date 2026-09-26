---
id: T-003
title: Implement the concurrency-safe in-memory user store
status: pending
phase: 2
depends_on: [T-001]
size: S
risk: low
---
## Goal
`internal/store` provides `Memory`, which can create and list users. It is safe under concurrent calls, rejects duplicate emails (ignoring case) and returns users in creation order. It is the storage behind the users API (T-004), which reaches it through an interface.

## Context
- Read `AGENTS.md` and `docs/plan/03-decisions/ADR-002-in-memory-user-store.md`.
- No store exists yet; the tree only has `internal/handler`. This package uses the standard library only: no gin, and no import of `internal/handler`.
- The user fields are provisional (Q1). If the user has answered Q1 differently, update ADR-002 first.

## Scope
- In:
  - `internal/store/store.go` (new): package doc, `User`, `ErrEmailTaken`
  - `internal/store/memory.go` (new)
  - `internal/store/memory_test.go` (new)
- Out: HTTP and format validation (T-004), persistence, update or delete.

## Steps
1. `store.go`:
   - `type User struct { ID, Name, Email string }`;
   - `var ErrEmailTaken = errors.New("store: email already taken")`.
2. `memory.go`:
   - `type Memory struct { mu sync.RWMutex; nextID int64; users []User; emails map[string]struct{} }` and `func NewMemory() *Memory`.
   - `Create(ctx context.Context, name, email string) (User, error)`:
     - return `ctx.Err()` if it is set;
     - normalize: `key := strings.ToLower(strings.TrimSpace(email))`, `name = strings.TrimSpace(name)`;
     - under the write lock: if `key` is already in `emails`, return `ErrEmailTaken`;
     - otherwise `nextID++`, set `ID = strconv.FormatInt(nextID, 10)`, append the user and add the email to the set.
   - `List(ctx context.Context) ([]User, error)`:
     - return `ctx.Err()` if it is set;
     - under the read lock, return `out := make([]User, len(m.users)); copy(out, m.users)`.
3. Tests (table-driven where it fits):
   - `TestMemory_CreateAssignsSequentialIDs`: IDs `"1"`, `"2"`; the stored email is lowercased and trimmed; the name is trimmed.
   - `TestMemory_DuplicateEmail`: `" Ada@Example.com "` after `"ada@example.com"` returns `errors.Is(err, ErrEmailTaken)`. The next successful create gets ID `"2"`, so the failed call did not use up an ID.
   - `TestMemory_ListEmptyIsNonNil`: the result is non-nil with length 0.
   - `TestMemory_ListReturnsCopy`: changing the returned slice does not change the store.
   - `TestMemory_ConcurrentCreate`: 100 goroutines create distinct emails. `List` then has 100 users with unique IDs.
   - `TestMemory_ConcurrentSameEmail`: 50 goroutines create the same email. Exactly 1 succeeds and 49 get `ErrEmailTaken`.
   - `TestMemory_CanceledContext`: both methods return `context.Canceled`.

## Acceptance criteria
- [ ] `store.User`, `store.ErrEmailTaken`, `store.NewMemory`, `(*Memory).Create` and `(*Memory).List` exist with the signatures above, and every exported identifier has a doc comment.
- [ ] Duplicate emails are rejected ignoring case and surrounding spaces, and a rejected create does not use up an ID.
- [ ] `List` returns a non-nil copy in creation order.
- [ ] The concurrency tests pass, and pass under `go test -race` in CI.
- [ ] `internal/store` imports only the standard library.
- [ ] `sh scripts/check.sh` passes.

## Verification
```sh
sh scripts/check.sh
go test -count=1 ./internal/store/
grep -q 'func TestMemory_ConcurrentCreate' internal/store/memory_test.go
grep -q 'func TestMemory_ConcurrentSameEmail' internal/store/memory_test.go
grep -q 'func TestMemory_DuplicateEmail' internal/store/memory_test.go
! grep -rq 'gin-gonic' internal/store
! grep -rq 'go-service/internal/handler' internal/store
```
Every command exits 0. If a C compiler is available, also run `go test -race -count=1 ./internal/store/`; CI always runs it.

## Risks and notes
- The race detector is the real proof of thread safety, and it runs in CI. The local tests still catch lost updates by counting users and checking IDs are unique.
- The package has no users until T-004. staticcheck's unused-code check (U1000) does not flag exported identifiers, so that is fine.
