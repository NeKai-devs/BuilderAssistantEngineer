# ADR-002: In-memory user store

- Status: Accepted (user fields provisional until Q1 is answered)
- Date: 2026-09-26

## Context
The brief asks for users "stored in memory", with a database out of scope. Several requests can hit the store at once. Other teams will depend on the shape and uniqueness rules of IDs and emails.

## Decision
- `store.User{ID, Name, Email string}`.
- `Memory` holds `sync.RWMutex`, `nextID int64`, `users []User` (in insertion order) and `emails map[string]struct{}` (the set of used emails).
- `Create(ctx, name, email) (User, error)`:
  - normalizes the email to `strings.ToLower(strings.TrimSpace(email))` and trims the name;
  - returns `ErrEmailTaken` if the email is already used;
  - otherwise increments `nextID` and stores the user, with ID `strconv.FormatInt(nextID, 10)`.
  - The check and the insert happen under one write lock, and an ID is used up only on success.
- `List(ctx) ([]User, error)` returns a fresh copy in insertion order, never `nil`.
- Both methods return `ctx.Err()` if the context is already cancelled. The `ctx` and `error` in the signatures are there so a future database-backed store fits the same interface.
- The API contract calls IDs **opaque strings**. Clients must not parse or order them.

## Alternatives considered
- **`sync.Map`.** Rejected: it cannot atomically check an email and insert across two structures, and it has no order.
- **A map keyed by ID, sorted on each list.** Rejected: more code for the same result.
- **UUIDs via `github.com/google/uuid`.** Rejected for now: a new dependency and non-deterministic test data. Because IDs are opaque, switching later won't break callers.
- **Integer IDs in JSON.** Rejected: that ties the contract to integers, and moving to UUIDs would break callers.
- **In-memory SQLite.** Rejected: a database is out of scope, and it adds cgo or a driver dependency.

## Consequences
- All data is lost on restart, and IDs start again at `"1"`. `docs/api.md` must say this.
- Each copy of the service has its own data, so run only one (A-3, Q5).
- Memory use has no limit. That is acceptable for an internal MVP; revisit if usage grows.
- `List` copies every user, costing O(n) per call. That is fine for thousands of users (A-8).
