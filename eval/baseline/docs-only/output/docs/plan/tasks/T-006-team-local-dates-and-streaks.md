---
id: T-006
title: Implement team-local date and streak utilities
status: pending
phase: 1
depends_on: [T-001]
size: S
risk: medium
---
## Goal
Two small, pure, fully tested modules answer "what day is it for this team?" and "how long is this streak?":
- `core/dates.py`: team-local dates, weeks and the logging window
- `core/streaks.py`: streak counts and how they are displayed

Logging (T-007), the board (T-008) and the digest (T-011, T-012) all call them, so time zone, DST and week-boundary bugs get fixed in one place.

## Context
- Read: ADR-006, `AGENTS.md` (domain rules 2 and 4).
- Rules (ADR-006):
  - A team's "today" is the current date in the team's IANA time zone.
  - Weeks run Monday to Sunday.
  - The logging window is `today-6 … today`.
  - A streak is the number of consecutive done days ending on a given day. The current streak ends today if today is done, otherwise yesterday (grace).
  - Streaks look back at most `STREAK_LOOKBACK_DAYS` (366) days, and 366 or more displays as `365+`.
- `team_today` is the only function that reads the clock (`django.utils.timezone.now`). Every other function takes `today`, `now` or a date as an argument.

## Scope
In:
- `core/dates.py`:
  - `team_today(tz_name: str, now: datetime | None = None) -> date` (`now` defaults to `timezone.now()`)
  - `to_local_date(moment: datetime, tz_name: str) -> date`
  - `week_start(day: date) -> date` (Monday) and `week_end(day: date) -> date` (Sunday)
  - `week_days(start: date) -> list[date]`
  - `parse_week_param(value: str | None, today: date) -> date` (an ISO date in the current or a past week → that week's Monday; None, invalid or future → the current week's Monday)
  - `is_loggable(day, today) -> bool` (`today - 6 <= day <= today`)
- `core/streaks.py`:
  - `STREAK_LOOKBACK_DAYS = 366`
  - `streak_ending(done_days: Collection[date], end: date) -> int`
  - `current_streak(done_days, today) -> int` (grace rule)
  - `count_in_range(done_days, start, end) -> int` (inclusive)
  - `format_streak(n: int) -> str` (`"365+"` when `n >= 366`)
- `core/tests/test_dates.py`, `core/tests/test_streaks.py`

Out: models, views, any caller changes.

## Steps
1. Implement with `zoneinfo.ZoneInfo`.
   - A naive `now` or `moment` raises `ValueError`.
   - An unknown zone raises `zoneinfo.ZoneInfoNotFoundError`; let it propagate.
2. Streak functions:
   - ignore days after `end`
   - tolerate duplicates and any iterable (convert to `set` once)
   - use an O(streak length) loop
3. Write parametrized tests for every case below.

## Acceptance criteria
- [ ] `team_today`:
  - [ ] `Europe/Madrid` at `2026-03-29T00:30Z` → `2026-03-29` (DST starts)
  - [ ] `Europe/Madrid` at `2026-10-24T22:30Z` → `2026-10-25` (DST ends)
  - [ ] `Pacific/Kiritimati` (UTC+14) at `2026-09-27T11:00Z` → `2026-09-28`
  - [ ] `Pacific/Pago_Pago` (UTC−11) at `2026-09-27T10:00Z` → `2026-09-26`
  - [ ] a naive datetime raises `ValueError`
- [ ] `to_local_date` converts an aware UTC datetime to the local date around midnight in both directions.
- [ ] `week_start`:
  - [ ] Monday maps to itself; Sunday `2026-09-27` → `2026-09-21`
  - [ ] `2027-01-01` → `2026-12-28`
  - [ ] `2024-02-29` → `2024-02-26`
- [ ] `week_end` is always `week_start + 6`. `week_days` returns 7 consecutive dates starting on Monday.
- [ ] `parse_week_param`:
  - [ ] `None`, `""` and `"garbage"` → the current week's Monday
  - [ ] `"2026-09-23"` → `2026-09-21`
  - [ ] a date in a future week → the current week's Monday
  - [ ] a past date → that week's Monday
- [ ] `is_loggable`: true for `today` and `today-6`; false for `today-7` and `today+1`.
- [ ] `streak_ending`:
  - [ ] empty set → 0
  - [ ] `end` not done → 0
  - [ ] 3 consecutive days ending at `end` → 3
  - [ ] a gap resets the count
  - [ ] streaks crossing month and year boundaries count correctly
  - [ ] duplicates, and days after `end`, do not change the result
- [ ] `current_streak`:
  - [ ] today and yesterday done → 2
  - [ ] only yesterday and the day before done → 2 (grace)
  - [ ] neither today nor yesterday done → 0
- [ ] `count_in_range` is inclusive on both ends.
- [ ] `format_streak(365)` → `"365"`; `format_streak(366)` → `"365+"`.
- [ ] `core/dates.py` and `core/streaks.py` have 100% line and branch coverage.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run pytest core/tests/test_dates.py core/tests/test_streaks.py -q
uv run pytest core/tests/test_dates.py core/tests/test_streaks.py --cov=core.dates --cov=core.streaks --cov-report=term-missing --cov-fail-under=100
uv run pytest --cov
```
Every command exits 0. The coverage report shows 100% for both modules.

## Risks and notes
- If Question 3 changes the model to per-member time zones, only the call sites change; these functions already take the zone name.
- Do not add caching or clock access anywhere else.
