---
id: T-004
title: Add teams with onboarding, invite links and request.team scoping
status: pending
phase: 1
depends_on: [T-003]
size: M
risk: high
---
## Goal
A signed-in user without a team either creates one (a name and a time zone), becoming its owner, or joins an existing team through its invite link. Every team-scoped view gets `request.team` and the `team_required` decorator. These are the base of team isolation for every later task.

## Context
- Read: ADR-005, ADR-006 (team time zone), `docs/plan/01-prd.md` (US-3, US-4, FR-2), `docs/plan/02-architecture.md` (Request flow, Security model), `AGENTS.md` (domain rules 1 and 5).
- Rules (ADR-005):
  - A user belongs to at most one team: `UniqueConstraint(fields=["user"], name="one_team_per_user")`.
  - A team has at most one owner: `UniqueConstraint(fields=["team"], condition=Q(role="owner"), name="one_owner_per_team")`. Services guarantee there is at least one.
  - Invite link: `/join/<token>/`, with the token from `secrets.token_urlsafe(24)`, unique. A team takes at most `TEAM_MAX_MEMBERS = 20` members (a settings constant).
- Gotchas:
  - Anonymous visitors who open an invite link must come back to it after logging in or signing up. Redirect them to login with `?next=/join/<token>/`; allauth honours `next` on both login and sign-up.
  - `request.team` and `request.membership` must be `SimpleLazyObject`s, so anonymous pages and pages that don't need them make no query.
  - Validate time zones against `zoneinfo.available_timezones()` and store the IANA name.

## Scope
In:
- `teams` app:
  - `models.py`: `Team(name CharField(60), timezone CharField(64), invite_token CharField unique, created_at)` and `Membership(team FK CASCADE related_name="memberships", user FK CASCADE, role choices owner/member, joined_at)`, with the two constraints above; migration `0001_initial`
  - `services.py`:
    - `create_team(user, name, timezone) -> Team`: atomic, and the creator becomes owner. Raises `AlreadyInTeam`.
    - `join_team(user, team) -> Membership`: raises `AlreadyInTeam` or `TeamFull`.
  - `middleware.py`: `CurrentTeamMiddleware` sets lazy `request.team` and `request.membership` (`None` for anonymous users and users without a team), placed after allauth's middleware
  - `access.py`:
    - `team_required`: anonymous users go to login; users without a team go to `teams:onboarding`
    - `TeamHttpRequest`: an `HttpRequest` subclass used only in type hints, with `team: Team` and `membership: Membership`
  - `forms.py`: `TeamForm(name, timezone)`, where the time zone is a `<select>` of sorted zones with default `UTC` and the attribute `data-tz-autodetect`
  - `views.py` and `urls.py` (`app_name = "teams"`):
    - `teams:onboarding` at `/team/new/`: GET shows the create form and a note about invite links; POST creates the team
    - `teams:join` at `/join/<str:token>/`: GET shows the team name and member count; POST joins
    - `teams:detail` at `/team/` (`@team_required`): the team name and time zone, the members with their roles, and the absolute invite URL in a read-only input
  - `admin.py`
- `core/views.py`: signed-in users at `/` go to `teams:onboarding` when they have no team, and to `teams:detail` otherwise (T-005 and T-008 change this target)
- `static/js/app.js`: pre-selects the browser's time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) in `select[data-tz-autodetect]` when that option exists; loaded from `base.html` with `defer`
- Templates: `teams/templates/teams/onboarding.html`, `join.html`, `detail.html`; `_nav.html` gains "Team"
- Tests: `teams/tests/test_models.py`, `test_onboarding.py`, `test_join.py`, `test_access.py`

Out: invite rotation, removal, leaving and ownership transfer (T-014); several teams per user (not planned).

## Steps
1. Models, constraints and the migration, then the services, with tests.
2. The middleware and `team_required`, with query-count tests for anonymous pages.
3. Views, forms, templates and `app.js`.
4. The invite flow for anonymous visitors, through both sign-up and login.

## Acceptance criteria
- [ ] Creating a team makes the creator its owner, and `/` then redirects to `/team/`.
- [ ] A second membership for the same user, or a second owner in one team, raises `IntegrityError` (constraint tests).
- [ ] An invalid time zone (`Mars/Base`) shows a form error. A valid zone is stored as the IANA name.
- [ ] `GET /join/<token>/` shows the team name to a signed-in user without a team. POST creates a `member` membership and redirects to `/team/`.
- [ ] An unknown token returns 404. A user who is already in a team gets a message and nothing changes. A full team (`TEAM_MAX_MEMBERS`) refuses with a message.
- [ ] An anonymous visitor opening `/join/<token>/` is redirected to login with `next`. After signing up through the link, they land back on the join page.
- [ ] `team_required`: anonymous users get a login redirect, signed-in users without a team get a redirect to `/team/new/`, members get 200.
- [ ] `/team/` lists only the viewer's team: another team's member names are absent. It shows the absolute invite URL.
- [ ] Anonymous `GET /` makes 0 database queries.
- [ ] The time zone select works without JavaScript. `app.js` is served from `/static/js/app.js`, and templates contain no inline handlers.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest teams -q
uv run pytest --cov
```
Every command exits 0.

## Risks and notes
- High risk because every later isolation guarantee rests on this task. Each team-scoped query in later tasks starts from `request.team`, and T-016 adds a route matrix that enforces it.
