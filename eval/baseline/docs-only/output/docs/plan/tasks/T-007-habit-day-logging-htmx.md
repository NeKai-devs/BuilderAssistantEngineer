---
id: T-007
title: Add habit day logging with an HTMX toggle and a demo seed command
status: pending
phase: 1
depends_on: [T-005, T-006]
size: M
risk: medium
---
## Goal
A member marks their habit done or not done for any day in the logging window with one tap. The UI is a 7-day strip per habit on `/habits/`. HTMX swaps a single cell, and the same form works without JavaScript. This task also adds a `seed_demo` command so later tasks and demos have realistic data.

## Context
- Read: ADR-006 (logging window, binary logs), `core/dates.py`, `core/streaks.py`, `habits/models.py`, `AGENTS.md` (HTMX conventions, domain rules 1–4).
- Gotchas:
  - Use set-state semantics (`done=1|0`), never flip-on-POST, so double taps are harmless.
  - Racing `get_or_create` calls can hit the unique constraint: catch `IntegrityError` inside a savepoint and treat the day as done.
  - Date path converter: register `core/converters.py: IsoDateConverter` (regex `\d{4}-\d{2}-\d{2}`). If `to_python` raises `ValueError`, Django treats the URL as not matching (404).
  - htmx doesn't swap 4xx responses by default. That's fine: a 400 leaves the cell unchanged.
- Add `time-machine` as a dev dependency for clock control in tests.

## Scope
In:
- `habits/models.py`: `HabitLog(habit FK CASCADE related_name="logs", day DateField, created_at auto)` with `UniqueConstraint(fields=["habit", "day"], name="habits_habitlog_one_per_day")`; migration `habits` `--name habitlog`.
- `habits/services.py`: `set_done(habit, day, done, today) -> bool`.
  - Raises `DayNotLoggable` when `not is_loggable(day, today)`, when `day < to_local_date(habit.created_at, tz)`, or when the habit is archived.
- `habits/selectors.py`: `done_days_by_habit(habit_ids, start, end) -> dict[int, set[date]]` (one query).
- `core/converters.py`, registered in `config/urls.py` or `habits/urls.py`.
- `habits/views.py`: `set_day`, POST `/habits/<int:pk>/days/<isodate:day>/`, named `habits:set_day`.
  - Allowed only for the owner's active habit in `request.team`; otherwise 404.
  - Form field `done` in `{"1","0"}`, anything else → 400. Not loggable → 400.
  - With `HX-Request`, render `habits/_log_cell.html`. Without it, redirect to a safe `next`, otherwise to `habits:list`.
- `habits/templates/habits/_log_cell.html`:
  - Editable cell: `<form method="post" action=... hx-post=... hx-target="this" hx-swap="outerHTML">` with `csrf_token`, hidden `done` (the opposite of the current state), hidden `next`, and `<button type="submit" aria-pressed="true|false" aria-label="<habit> on <Weekday D Mon>: done|not done">`.
  - Read-only cell: `<span role="img" aria-label=...>`.
- `habits/templates/habits/list.html`: each habit row shows cells for `today-6 … today` (team-local), plus `format_streak(current_streak(...))`.
- `static/css/app.css`: cell styles. Done and not done must differ in shape and symbol, not only color (✓ vs ○).
- `habits/management/commands/seed_demo.py`:
  - Refuses unless `settings.DEBUG` or `--force`.
  - Idempotently creates team "Demo Team" (`Europe/Madrid`), users `alice@example.com`, `bob@example.com` and `carol@example.com` (password `demo-pass-123`, display names Alice, Bob, Carol) and 2–3 habits each.
  - Creates deterministic logs (seeded `random.Random(42)`) for the past 21 days, relative to `team_today`.
- `pyproject.toml`/`uv.lock` (`time-machine` dev dependency)
- Tests: `habits/tests/test_logging.py`, `habits/tests/test_seed_demo.py`

Out: the board (T-008); logging other members' habits (never).

## Steps
1. Model and migration, then the selector and service.
2. Converter, view and partial. Build cell contexts in Python (`day`, `done`, `editable`, `label`), not in template logic.
3. Update `list.html` to use one selector query for all of the user's habits.
4. `seed_demo`, then the tests.

## Acceptance criteria
- [ ] POST `done=1` for today creates exactly one `HabitLog`. Repeating the POST keeps one row.
- [ ] POST `done=0` deletes the row. Repeating the POST is a no-op.
- [ ] POSTs for `today-7`, `today+1`, or a day before the habit's creation date return 400 and change nothing.
- [ ] Another member's habit, another team's habit and an archived habit return 404.
- [ ] GET returns 405. Anonymous users are redirected to login.
- [ ] With `HX-Request: true` the response is 200 and contains only the cell partial, with `aria-pressed` reflecting the new state and hidden `done` set to the opposite.
- [ ] Without the HX header the response is 302 to a safe `next`. `next=https://evil.example/` falls back to `/habits/`.
- [ ] A client with `enforce_csrf_checks=True` and no token gets 403.
- [ ] "Today" follows the team time zone. With time-machine frozen at `2026-09-27T23:30Z` and team `Asia/Tokyo`, logging `2026-09-28` is allowed. For team `America/New_York` at the same instant it returns 400.
- [ ] `/habits/` shows 7 cells per habit (today-6 … today) and a streak value.
- [ ] Running `seed_demo --force` twice leaves the same counts of users, habits and logs. Without `--force` and with `DEBUG=False` it exits with an error and creates nothing.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest habits -q
uv run pytest --cov
uv run python manage.py migrate --noinput
uv run python manage.py seed_demo --force
```
Every command exits 0. `seed_demo` prints a summary of what was created or reused.

## Risks and notes
- The demo password is a development-only fixture. Add a ruff `S106` per-line ignore with a comment. The command must never run in production without `--force` (and no runbook uses it there).
