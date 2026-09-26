---
id: T-008
title: Build the weekly team board
status: pending
phase: 1
depends_on: [T-007]
size: L
risk: medium
---
## Goal
`/board/` shows the team's week (Monday to Sunday):
- every current member (viewer first), their habits visible that week, done marks and a streak per habit
- week navigation
- the viewer's own cells toggle in place (T-007 partial)
- a layout that works at 360 px
- a constant number of queries

Members land here from `/`. This completes the first deliverable.

## Context
- Read: ADR-006 (streak rules for current and past weeks), `docs/plan/01-prd.md` (US-6, FR-5), `habits/selectors.py`, `habits/templates/habits/_log_cell.html`, `core/dates.py`, `core/streaks.py`.
- Habit visibility for a week, computed in team-local dates:
  - `to_local_date(created_at) <= week_end`
  - and `archived_at is None or to_local_date(archived_at) >= week_start`
- Streak column:
  - current week → `current_streak(done, today)`
  - past week → `streak_ending(done, week_end)`
  - displayed with `format_streak`
- Logs are fetched for `[week_end - STREAK_LOOKBACK_DAYS + 1, week_end]` in one query.
- A cell is editable if and only if: the viewer owns the habit, the habit is active, `is_loggable(day, today)`, and the day is on or after the habit's creation date.

## Scope
In:
- `habits/selectors.py`:
  - `team_members(team) -> list[Membership]`, one query with `select_related("user")`, ordered by viewer first, then case-insensitive display name, then email (ordering applied in `board.py`)
  - `visible_habits_for_week(team, week_start) -> list[Habit]`, one query that filters in SQL by UTC bounds widened by one day, then filters exactly in Python with `to_local_date`
- `habits/board.py`: frozen dataclasses `BoardCell`, `BoardHabitRow`, `BoardMember`, `Board(week_start, week_end, days, today, is_current_week, prev_week, next_week, members)` and `build_board(team, viewer, week_start, today) -> Board`
- `habits/views.py`: `board` at `/board/` (`habits:board`, `@team_required`) using `parse_week_param(request.GET.get("week"), today)`
- `habits/templates/habits/board.html`:
  - header "Week of Mon D – Sun D Mon YYYY"
  - prev link; next link only when not the current week; "This week" link when viewing another week
  - one `<table>` per member with a `<caption>` (member name, "(you)" for the viewer)
  - `<th scope="col">` for day headers (letter plus date); today's header has `aria-current="date"` in the current week only
  - `<th scope="row">` for habit names, a streak column, and cells from `_log_cell.html`
  - empty states (the viewer gets a "Create your first habit" link)
- `static/css/app.css`: board layout. The habit name column wraps; day cells are at least 36×36 px; no horizontal page scroll at 360 px; today's column is highlighted by a border and not by color alone.
- `core/views.py`: members are redirected from `/` to `/board/`.
- `templates/_nav.html`: "Board" as the first item.
- `docs/qa/manual-checklist.md`: create it with the board section (see Acceptance criteria).
- `habits/tests/test_board.py`

Out: team completion percentages, charts, filters (not planned); the digest (T-011).

## Steps
1. Selectors, then `build_board` with unit tests on the dataclasses.
2. View and template, reusing the cell partial with `next` set to the current board URL including `?week=`.
3. CSS and manual QA with `seed_demo`.
4. Query-count tests using `django_assert_max_num_queries` and `CaptureQueriesContext`.

## Acceptance criteria
- [ ] Members are redirected from `GET /` to `/board/`. Anonymous users are redirected to login; users without a team to onboarding.
- [ ] The board lists every current member of the viewer's team, viewer first, and nothing from other teams (member names and habit names of another team are absent).
- [ ] Only the viewer's cells that are editable (see Context) contain a `<form>`. Every other cell is read-only, including all of other members' cells.
- [ ] `?week=`:
  - [ ] the Wednesday of a past week renders that week (Mon–Sun)
  - [ ] a future date renders the current week
  - [ ] garbage renders the current week
  - [ ] the next link is absent in the current week and present in past weeks
- [ ] Habit visibility:
  - [ ] archived before the week started → hidden
  - [ ] archived mid-week → shown
  - [ ] created after the week ended → hidden
- [ ] Streak column:
  - [ ] current week: today not done, previous 3 days done → 3
  - [ ] past week: Sunday not done → 0
  - [ ] a streak of 366 or more renders as `365+`
- [ ] `aria-current="date"` appears exactly once in the current week and never in past weeks.
- [ ] The request makes at most 8 queries, and the count is identical for a team of 2 members × 1 habit and 8 members × 5 habits.
- [ ] Each member table has a `<caption>`, and the day headers use `scope="col"`.
- [ ] `docs/qa/manual-checklist.md` has a "Board" section:
  - 360×740 viewport, no horizontal page scroll
  - toggling today updates without a page reload
  - toggling with JavaScript disabled works through a redirect
  - Tab reaches every editable cell and Enter/Space toggles it
  
  Results are recorded in the Completion notes.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest habits/tests/test_board.py -q
uv run pytest --cov
test -f docs/qa/manual-checklist.md
```
Every command exits 0. The manual checklist results are recorded in this file's Completion notes.

## Risks and notes
- The largest task in Phase 1. If it overruns a session, split off the CSS and the manual QA into a follow-up task (new ID) rather than skipping the tests.
- Keep `visible_habits_for_week` in selectors: T-011 reuses it for the digest.
