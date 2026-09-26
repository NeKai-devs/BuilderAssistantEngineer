# Plan overview — Team accounts for node-app

## Goal
Add team accounts to the existing Express API. A team has members with roles `owner` and `member`. Owners invite users by email. Invitees accept and become members. Members can list the team. Every existing route keeps working unchanged.

## First deliverable (MVP)
1. Create a team (the creator becomes its owner).
2. Invite a user by email (owners only).
3. Accept an invite (the invitee, with the emailed token).
4. List a team's members with their roles.

## Non-scope
Billing, SSO, UI. Also deferred: listing a user's teams, resending or revoking invites, removing members, role changes and ownership transfer, durable storage, a real email provider, rate limiting, `/users` pagination, CLI argument parsing.

## Approach
- **Phase 1: Baseline and safety net.** Fix the declared-but-broken toolchain, add the missing formatter, and make CI real (T-001). Extract a `createApp()` factory and pin `GET /users` with an HTTP test (T-002).
- **Phase 2: Teams MVP, in vertical slices.** HTTP foundation (errors, validation, identity; T-003), then domain store and tokens (T-004), then create team and list members (T-005), invite (T-006), accept (T-007), and finally an end-to-end smoke test against the build plus docs (T-008).

Each phase ends in a demoable, tested state. See `04-roadmap.md`.

## Key decisions
| ADR | Decision |
| --- | --- |
| ADR-001 | Fix the toolchain first: NodeNext ESM build, typescript-eslint, Prettier, real CI |
| ADR-002 | `createApp()` factory; in-process HTTP tests with supertest under Vitest |
| ADR-003 | `X-User-Email` identity header, off in production unless explicitly enabled |
| ADR-004 | In-memory store behind an async `TeamStore` interface |
| ADR-005 | Random invite tokens, stored hashed, single-use, 7-day TTL, bound to the email; delivered via `Mailer`; accepted via the request body |
| ADR-006 | zod validation, uniform JSON error envelope, new middleware scoped to new routers |

## Assumptions (not verified; revisit if an answer changes)
- A1: Identity comes from the `X-User-Email` header (Q1). Not safe for untrusted production traffic.
- A2: In-memory storage is acceptable for the first deliverable (Q2).
- A3: A console mailer is acceptable for now (Q3).
- A4: Users can belong to multiple teams, and any member can list members (Q4).
- A5: Invites always grant `member`, and the creator is the only owner (Q5).
- A6: Team members don't appear in `GET /users`, which keeps returning `[]`.
- A7: Node >= 22 is available locally and in CI, and T-001 has network access for `npm install`.
- A8: The baseline defects were inferred by reading config files. No commands were run during planning.
- A9: No production deployment exists: no Dockerfile or deploy workflow found, and the README describes a fixture. So failing closed in production is not a regression for any known consumer.

## Documents
- `01-prd.md`: requirements and the API contract
- `02-architecture.md`: current state with evidence, target state, migration path
- `03-decisions/`: ADRs
- `04-roadmap.md`: phases, demo criteria, dependency graph, task index
- `tasks/`: one file per task
