---
id: T-011
title: Build the weekly digest summary and email rendering
status: pending
phase: 2
depends_on: [T-008, T-010]
size: M
risk: medium
---
## Goal
Given a team and a completed week, compute a correct summary:
- per member: each habit's done count out of possible days, and the streak at week end
- team highlights

Render the personalized Monday email (subject, text, HTML) from that summary. A preview page lets members see last week's email in the browser. This is the content half of the digest; sending comes in T-012.

## Context
- Read: ADR-007, ADR-006 (week-end streak), `habits/selectors.py` (`visible_habits_for_week`, `done_days_by_habit`), `core/email.py`, `docs/plan/01-prd.md` (US-7).
- Rules:
  - The week is `week_start` (Monday) to `week_end` (Sunday).
  - Members are the team's current memberships.
  - Possible days for a habit are the days in the week between its local creation date and its local archive date (inclusive), when set.
  - The streak is `streak_ending(done, week_end)`, formatted with `format_streak`.
  - Logs after `week_end` are ignored.
- Highlights:
  - top 3 habit streaks of at least 3 days across the team (member name, habit name, streak)
  - total check-ins for the team that week
- Gotcha: the preview page renders email HTML that uses inline styles. T-016 will relax the CSP for this one view; don't work around it here.

## Scope
In:
- New app `digest` (`apps.py`, registered in `INSTALLED_APPS`, `urls.py` with `app_name = "digest"`, included in `config/urls.py`)
- `digest/summary.py`: frozen dataclasses `HabitWeek(name, done, possible, streak_display)`, `MemberWeek(user_id, name, habits)`, `Highlight(member_name, habit_name, streak)`, `TeamWeek(team_id, team_name, week_start, week_end, members, highlights, total_checkins)`; `build_team_week(team, week_start) -> TeamWeek`, with at most 4 queries whatever the team size
- `digest/emails.py`: `RenderedEmail(subject, text, html)`; `render_weekly_digest(recipient, summary, *, unsubscribe_url: str | None = None) -> RenderedEmail`
  - subject `"<Team>: your week of <Mon D>–<D>"`, or `"<Mon D> – <Mon D>"` across months
  - the recipient's own section first, then the other members, highlights, and a board link (`SITE_URL + reverse("habits:board") + "?week=<week_start>"`)
  - an unsubscribe footer when a URL is given
- Templates: `digest/templates/digest/email/weekly.txt`, `weekly.html` (full document) and `_weekly_body.html` (body only, shared); `digest/templates/digest/preview.html`
- `digest/views.py`: `preview` at `/digest/preview/?week=` (`@team_required`)
  - defaults to the last completed week (`week_start(today) - 7 days`)
  - a future week or the current week clamps to the last completed week
  - renders `_weekly_body.html` for `request.user`
- Tests: `digest/tests/test_summary.py`, `test_emails.py`, `test_preview.py`

Out: sending, delivery records, scheduling (T-012); unsubscribe tokens (T-013).

## Steps
1. `build_team_week` reusing the board selectors. Add a `habits/selectors.py` helper only if one is missing, and keep the board's tests green.
2. Renderer and templates (plain, readable, no images, no tracking).
3. Preview view, then tests with a fixture team:
   - A has 7/7 and a streak carried from the week before (10)
   - B joined and created a habit on Thursday (3/4)
   - C has no habits
   - D (another team) must be absent
   - one habit archived before the week, one archived mid-week (possible days trimmed)

## Acceptance criteria
- [ ] Fixture results: A's habit shows `7/7` and streak `10`; B's shows `3/4`; C appears with "No habits yet"; the other team's data is absent.
- [ ] Habit archived before the week: excluded. Habit archived mid-week: included, with `possible` counting only the days up to the archive date.
- [ ] Logs on the Monday after the week don't change streaks or counts.
- [ ] `total_checkins` equals the number of logs in the week for visible habits. Highlights are ordered by streak descending, at most 3, each at least 3.
- [ ] `build_team_week` runs at most 4 queries, the same for 3 and 10 members.
- [ ] Subject formats: `2026-09-21` week → `"Acme: your week of Sep 21–27"`; `2026-09-28` week → `"Acme: your week of Sep 28 – Oct 4"`.
- [ ] In both text and HTML, the recipient's section comes first and every current member's name appears.
- [ ] A `display_name` of `<script>x</script>` is escaped in the HTML.
- [ ] The board link is absolute and uses `SITE_URL`.
- [ ] `/digest/preview/`: anonymous users → login redirect; members get 200 showing last completed week's content; `?week=` with a future date clamps to the last completed week.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest digest -q
uv run pytest --cov
```
Every command exits 0.

## Risks and notes
- Cut list item 3: the preview view may be dropped if Phase 2 runs late; the summary and renderer may not.
