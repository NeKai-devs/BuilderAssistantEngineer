# ADR-004: In-memory storage behind an async `TeamStore` interface

- Status: Accepted (provisional, pending Q2)
- Date: 2026-09-26

## Context
There is no database or persistence layer. The only route returns a literal (src/routes/users.ts:5). The first deliverable must prove the team flow, and durability requirements are unknown.

## Decision
- `src/teams/store.ts` defines an async `TeamStore`:
  - `createTeam`, `getTeam`, `getMembership`, `listMembers`
  - `findPendingInvite`, `createInvite`, `deleteInvite`
  - `findInviteByTokenHash`, `acceptInvite`
- `src/teams/memory-store.ts` implements it with `Map`s:
  - Multi-step mutations (`createTeam` + owner membership; `acceptInvite` = mark accepted + add membership) run as one synchronous block with no `await` between check and write, so they are atomic on Node's event loop.
  - It returns copies so callers can't mutate internal state.
  - `acceptInvite` returns a discriminated result (`ok` or `not_found | not_pending | already_member`) instead of throwing.
- The interface is async so a database implementation can drop in without changing callers.

## Alternatives
- **SQLite (better-sqlite3):** durable and simple, but a native build dependency plus migrations. Choose it when durability is required (Q2).
- **PostgreSQL + query builder:** production-grade, but infrastructure overhead for an MVP with no deployment target.

## Consequences
- Data is lost on restart. Single process only.
- A database implementation must use transactions for `createTeam` and `acceptInvite`, plus unique constraints on `(teamId, email)` for memberships.
- Tests are fast and deterministic.
