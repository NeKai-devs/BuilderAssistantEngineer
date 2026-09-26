# ADR-005: Team tenancy — one team per user, scoped by request.team

- Status: Accepted (subject to open question 4)
- Date: 2026-09-26

## Context
Teams must never see each other's data. Small teams share everything inside the team. The data model should stay simple enough for a six-week build.

## Decision
- The model is `Team(name, timezone, invite_token)` plus `Membership(team, user, role)`, where role is `owner` or `member`.
- **Single team:** a user belongs to at most one team (constraint `one_team_per_user`).
- **Single owner:** each team has exactly one owner. A conditional unique constraint (`one_owner_per_team`) guarantees at most one. Services guarantee at least one: a transfer demotes the old owner, then promotes the new one, inside one transaction.
- **Invites:** a secret link `/join/<token>/` (`secrets.token_urlsafe(24)`). Anyone signed in who has the link can join while the team has fewer than `TEAM_MAX_MEMBERS` (20) members. The owner can rotate the token (T-014).
- **Scoping:**
  - `CurrentTeamMiddleware` sets `request.team`.
  - Team views use `team_required`, and owner actions use `owner_required`.
  - Queries start from `request.team`, and writes also filter on `owner=request.user`.
- **Error responses:** another team's object → 404, so its existence isn't revealed. A non-owner on an owner action → 403. Anonymous → login redirect.
- **Departure** (removed, left, or deleted account): the membership is deleted and the member's active habits are archived. The team's history keeps their archived habits.
  - An owner must transfer ownership before leaving, unless they are the only member; in that case the team is deleted.
- **Visibility:** every member sees every member's habits and logs. There are no private habits in v1.

## Consequences
- Upside: one unambiguous team per request, and simple board, digest and deletion rules.
- Downside: people in two groups need two accounts. This is revisited if open question 4 changes.

## Alternatives considered
- **Several teams per user:** needs a team switcher, the team in the URL, and per-team preferences.
- **Postgres row-level security:** not portable to SQLite.
- **Subdomain per team:** DNS and TLS complexity.
