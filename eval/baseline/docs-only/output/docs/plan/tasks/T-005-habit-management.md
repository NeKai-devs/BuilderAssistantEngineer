---
id: T-005
title: Let members create, rename and archive their own habits
status: pending
phase: 1
depends_on: [T-004]
size: M
risk: medium
---
## Goal
Members manage their own habits at `/habits/`: create (a name of 1–60 characters), rename and archive. A habit belongs to one member in one team. Everyone in the team will see it on the board (T-008), but only its owner can change it.

## Context
- Read: ADR-005, ADR-006 (visibility depends on `created_at` and `archived_at`), `docs/plan/01-prd.md` (US-5, FR-3), `teams/access.py`, `AGENTS.md` (domain rule 1).
- Rules:
  - `MAX_ACTIVE_HABITS_PER_MEMBER = 10` (a settings constant). Creating an 11th shows a form error.
  - Archiving sets `archived_at = timezone.now()`. Archived habits are read-only, leave the active list and stay in history (past board weeks, digests). There is no unarchive in v1.
  - Write lookups filter on `team=request.team`, `owner=request.user` and `archived_at__isnull=True`. Anything else is a 404.
- Gotchas:
  - Always use `get_object_or_404(Habit, pk=pk, team=request.team, owner=request.user, archived_at__isnull=True)`, never a lookup by pk alone.
  - Archiving is POST-only, with a GET confirmation page so it works without JavaScript.

## Scope
In:
- `habits` app:
  - `models.py`: `Habit(team FK CASCADE related_name="habits", owner FK user CASCADE related_name="habits", name CharField(60), created_at auto_now_add, archived_at DateTimeField null)` with an index on `(team, archived_at)`; migration `0001_initial`
  - `services.py`: `create_habit(membership, name) -> Habit` (raises `HabitLimitReached`), `rename_habit(habit, name) -> None`, `archive_habit(habit) -> None`
  - `selectors.py`: `active_habits_for(user, team) -> QuerySet[Habit]`
  - `forms.py`: `HabitForm(name)`, stripped, 1–60 characters
  - `views.py` and `urls.py` (`app_name = "habits"`), all `@team_required`:
    - `habits:list` GET `/habits/`: the viewer's active habits, plus a create form that posts to `habits:create`
    - `habits:create` GET/POST `/habits/new/`
    - `habits:edit` GET/POST `/habits/<int:pk>/edit/`
    - `habits:archive` GET confirmation, POST `/habits/<int:pk>/archive/`
  - `admin.py`
- `core/http.py`:
  - `is_htmx(request) -> bool`: true only when `HX-Request: true`
  - `safe_next_url(request, fallback: str) -> str`: uses `url_has_allowed_host_and_scheme` with `require_https=request.is_secure()`
- `core/views.py`: members at `/` go to `habits:list`
- Templates: `habits/templates/habits/list.html`, `form.html`, `archive_confirm.html`; `_nav.html` gains "Habits"
- Tests: `habits/tests/test_habits_crud.py`, `core/tests/test_http.py`

Out: logging (T-007); the board (T-008); reordering, colors and frequencies (not planned, see ADR-006).

## Steps
1. The model and migration, then the services and selectors.
2. `core/http.py`, with tests.
3. Views, forms and templates.
4. Isolation and query-count tests.

## Acceptance criteria
- [ ] A member creates a habit and it appears on `/habits/`. A blank name or a 61-character name shows an error. An 11th active habit shows an error and nothing is created.
- [ ] The owner can rename a habit. Another member of the same team, or a user from another team, gets 404 on edit and archive, for both GET and POST.
- [ ] Archive: GET shows a confirmation and changes nothing. POST sets `archived_at`, and the habit leaves the active list. Edit and archive on an archived habit return 404.
- [ ] `/habits/` lists only the viewer's active habits. Anonymous users get a login redirect; users without a team get a redirect to onboarding.
- [ ] `safe_next_url` keeps relative paths and falls back for `https://evil.example/`, `//evil.example` and `javascript:alert(1)`.
- [ ] `is_htmx` is true only for `HX-Request: true`.
- [ ] `/habits/` makes the same number of queries for 1 habit and for 10.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest habits core -q
uv run pytest --cov
```
Every command exits 0.

## Risks and notes
- Keep the services free of request objects: T-014 reuses `archive_habit` when members leave or are removed.
