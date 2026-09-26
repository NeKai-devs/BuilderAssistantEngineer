# ADR-003: SQLite for development and tests, PostgreSQL 17 in production

- Status: Accepted
- Date: 2026-09-26

## Context
Local setup and test runs should be instant, for the developer and for agents. Production needs a managed database with backups.

## Decision
- The default database is `sqlite:///db.sqlite3`. When `DATABASE_URL` is set it takes over (django-environ).
- Production uses Render-managed PostgreSQL 17.
- CI runs the full test suite against PostgreSQL 17 on every push.
- Use only ORM features that work on both databases:
  - Allowed: conditional and functional unique constraints, transactions, `select_for_update` (a no-op on SQLite, so it isn't relied on).
  - Not allowed: `ArrayField`, Postgres-only JSON lookups, `distinct(*fields)`, deferrable constraints, raw SQL.
- Store timestamps in UTC. Store team-local calendar days as `DateField`.

## Consequences
- Upside: no Docker needed for day-to-day work.
- Downside: SQLite and Postgres behave differently in places. The CI Postgres job covers that. Concurrency guarantees such as the digest claim rely on unique constraints, which behave the same on both.

## Alternatives considered
- **Postgres everywhere, run in Docker:** heavier for agents and local setup.
- **SQLite in production with Litestream:** cheaper, but more operations work and no managed backups on Render.
