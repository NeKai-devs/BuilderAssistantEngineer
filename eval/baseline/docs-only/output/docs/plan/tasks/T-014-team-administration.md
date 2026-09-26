---
id: T-014
title: "Add team administration: settings, invite rotation, removal, leaving, ownership transfer"
status: pending
phase: 3
depends_on: [T-008]
size: M
risk: medium
---
## Goal
Owner actions: edit the team's name and time zone, rotate the invite link, remove members, transfer ownership.

Member actions: leave the team.

Departing members disappear from the board and their habits are archived. The single-owner invariant always holds.

## Context
- Read: ADR-005, `teams/models.py` (constraints), `teams/services.py`, `teams/access.py`, `habits/services.py`, `docs/plan/01-prd.md` (US-10).
- Gotchas:
  - The `one_owner_per_team` constraint is not deferrable on SQLite. Transfer ownership inside one transaction by demoting the current owner first, then promoting the new one.
  - `owner_required` returns 403 to members of the same team. Membership ids from other teams return 404.
  - Changing the time zone shifts "today" (ADR-006); state this in the settings form's help text.

## Scope
In:
- `teams/access.py`: `owner_required` (implies `team_required`)
- `teams/services.py`: `update_team(team, name, timezone)`, `rotate_invite(team)`, `remove_member(actor_membership, target_membership)` (not self), `leave_team(membership)`, `transfer_ownership(owner_membership, target_membership)`
  - Removing or leaving archives the departing user's active habits in that team (`archived_at=now`) and deletes the membership.
  - An owner can't leave while other members exist.
  - A sole owner leaving deletes the team (habits and logs cascade).
- `teams/views.py` and `urls.py`:
  - `teams:settings` GET/POST `/team/settings/` (owner)
  - `teams:rotate_invite` POST `/team/invite/rotate/` (owner)
  - `teams:remove_member` GET confirm, POST `/team/members/<int:membership_id>/remove/` (owner)
  - `teams:transfer_ownership` POST `/team/members/<int:membership_id>/make-owner/` (owner)
  - `teams:leave` GET confirm, POST `/team/leave/`
- Templates in `teams/templates/teams/`: `settings.html`, `remove_confirm.html`, `leave_confirm.html`; `detail.html` shows owner actions only to the owner
- Tests: `teams/tests/test_admin_actions.py`

Out: multiple teams per user; email notifications about removals (not planned).

## Steps
1. Add `owner_required` and the services (`update_team`, `rotate_invite`, `remove_member`, `leave_team`, `transfer_ownership`), each in one transaction. Test the single-owner invariant and habit archiving first.
2. Add the views, URLs and confirm templates, and show owner actions on `detail.html` only to the owner.
3. Write the permission matrix tests, the invite rotation tests and the time-machine test for a time zone change.

## Acceptance criteria
- [ ] Permission matrix for each owner-only endpoint: owner → success, member → 403, anonymous → login redirect. A `membership_id` from another team → 404.
- [ ] After rotation, the old invite URL returns 404, the new one works, and `/team/` shows the new URL.
- [ ] Removing a member:
  - [ ] deletes the membership and archives their active habits
  - [ ] the removed user is sent to onboarding from `/`
  - [ ] the removed user disappears from the board
  - [ ] the owner can't remove themselves (400 or a message, nothing changes)
- [ ] Ownership transfer swaps the roles, and the team has exactly one owner afterwards (asserted by query).
- [ ] Member leaving: the membership is deleted and habits are archived. An owner with other members is blocked with a message. A sole owner leaving deletes the team, its habits and its logs.
- [ ] Team settings: a valid name and time zone update the team; an invalid time zone shows a form error. After changing the zone, the board's "today" follows the new zone (time-machine test).

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest teams habits -q
uv run pytest --cov
```
Every command exits 0.

## Risks and notes
- Cut list item 2: settings editing and ownership transfer may be dropped if behind; rotation, removal and leaving may not.
