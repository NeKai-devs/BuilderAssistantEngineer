<!-- bae:begin -->
# AGENTS.md — TeamHabits

TeamHabits is a habit tracker for small teams. Each member logs their own daily habits, the whole team sees a shared weekly board, and every Monday each member gets an email that sums up the team's week and streaks. It is a mobile-friendly web app with no native apps and no payments. One developer builds it with AI agents, and launch is planned for 2026-11-06.

The plan lives in `docs/plan/`:
- `01-prd.md`: what to build
- `02-architecture.md`: how it fits together
- `03-decisions/`: ADRs explaining why
- `04-roadmap.md`: when, plus the cut list, risks and open questions
- `tasks/`: the work items

Some paths below are created by later tasks. Check what exists before assuming a file is there.

## Stack
- Python 3.12, Django 5.2 LTS, one repo, one deployable (ADR-001)
- Server-rendered templates, htmx 2 and Pico.css 2, vendored in `static/vendor/`. No Node, no build step.
- django-allauth for email + password accounts, with a custom `accounts.User` (ADR-004)
- SQLite locally and in tests; PostgreSQL 17 in CI and production (ADR-003)
- uv, ruff, mypy + django-stubs, pytest + pytest-django + pytest-cov, BeautifulSoup, and time-machine (added in T-007) (ADR-002)
- Render: a Docker web service (gunicorn, whitenoise), an hourly cron job and managed Postgres. Optional Sentry. Email via Resend through django-anymail (ADR-007, ADR-008).

## Repository layout
```
config/      settings.py (one env-driven settings module), urls.py, wsgi.py, asgi.py
core/        landing, healthz, dates.py, streaks.py, http.py, email.py, checks.py, legal pages
accounts/    custom User, sign-up form, account settings, account deletion
teams/       Team, Membership, middleware (request.team), access.py, services.py
habits/      Habit, HabitLog, services.py, selectors.py, board.py, seed_demo
digest/      summary.py, emails.py, sending.py, unsubscribe.py, DigestDelivery
templates/   base.html, partials (_nav.html, _messages.html), error pages, allauth overrides, email/
static/      css/app.css, js/app.js, vendor/ (htmx, Pico, README.md with SHA-256)
docs/        plan/, runbooks/, qa/
```

## Commands
```sh
make install      # uv sync --locked
make run          # development server
make migrate      # apply migrations
make fmt          # ruff format + ruff check --fix
make check        # every standard gate, in order
make audit        # dependency vulnerability audit (from T-016; needs network)
uv run python manage.py seed_demo --force   # demo team and data (from T-007)
```

## Standard gates
Every task runs these before it's done. `make check` runs the same commands in the same order.
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest --cov
```
Total coverage must stay at 85% or more. `core/dates.py` and `core/streaks.py` stay at 100%.

## Workflow
1. Work comes from `docs/plan/tasks/T-NNN-*.md`, one task at a time. `/next` picks the lowest-numbered ready task. A task is ready when it's `pending` and every task in `depends_on` is `done`.
2. Statuses: `pending` → `in_progress` → `done`. `blocked` is also allowed, with the reason written under "Risks and notes".
3. Stay inside the task's Scope; items listed as "Out" belong to other tasks. If something outside Scope is unavoidable, do the minimum and record it in the Completion notes.
4. The task's Verification block and `make check` must pass. Never weaken, skip, `xfail` or delete tests to get a green run.
5. The `reviewer` subagent must return PASS before the task is marked done.
6. To close a task, append `## Completion notes`, set `status: done`, and commit as `<type>(<scope>): <summary> (T-NNN)`. Types: feat, fix, test, refactor, docs, chore, ci, build. Do not push.
7. To change a decision, write a new or superseding ADR in `docs/plan/03-decisions/`; never edit an accepted ADR silently. The human approves ADR changes.

## Domain rules
Tasks refer to these by number.
1. **Team isolation.** Every team-scoped query starts from `request.team`, or from a team passed into a service. Writes to habits and logs also filter on `owner=request.user`. Objects from another team return 404, never 403. Owner-only actions return 403 to other members of the same team. (ADR-005)
2. **Time.** The team's IANA time zone defines "today" and the week boundaries. Only `core/dates.py` turns the clock into dates (`team_today`, `to_local_date`); everything else receives `now` or `today` as an argument. `timezone.now()` is fine for timestamps (`created_at`, `archived_at`), never for dates. (ADR-006)
3. **Logging.** Logs are binary: a `HabitLog` row for `(habit, day)` means done. Only the habit's owner can log, and only when all of these hold:
   - the day is within team-local `today-6 … today`
   - the day is not before the habit's local creation date
   - the habit is not archived

   Endpoints set a state (`done=1|0`); they never toggle. (ADR-006)
4. **Streaks.** Streaks are computed only in `core/streaks.py`:
   - consecutive done days
   - the current streak has one day of grace (an unlogged today doesn't break it)
   - past weeks show the streak at week end
   - 366 or more displays as `365+`

   (ADR-006)
5. **Teams.** A user belongs to at most one team, and every team has exactly one owner. When a member departs, their active habits are archived. (ADR-005)
6. **Digest.** Only `digest.sending.send_due_digests` sends digest emails, through the `send_weekly_digests` command. Each user gets at most one per week (the claimed `DigestDelivery` row), and only at the verified primary address of a member with `weekly_digest_enabled`. (ADR-007)
7. **Privacy.** Store only the data the PRD lists. No analytics, trackers or third-party assets. No personal data in logs beyond user ids. Sentry runs with `send_default_pii=False`.

## Code conventions
- Keep views thin. Business rules live in `<app>/services.py`: atomic, and raising domain exceptions. Reads live in `<app>/selectors.py`, and their query counts must not grow with team size. No signals for business logic.
- Use only ORM features that both SQLite and Postgres support, and no raw SQL. Give migrations names (`makemigrations <app> --name <what>`), and never edit a committed migration.
- Type every function (mypy strict, as configured in `pyproject.toml`). Log with `logging.getLogger(__name__)`, never `print`; management commands write to `self.stdout`.
- Settings come from env via django-environ in `config/settings.py`. Every new variable goes into `.env.example` and the relevant runbook.
- Mutations happen only through POST with CSRF. Redirect targets go through `core.http.safe_next_url`.
- URL names are namespaced (`habits:board`). App templates live in `<app>/templates/<app>/`.

## Templates and CSS
- Pages extend `base.html`, fill the `head_title` and `content` blocks, and have exactly one `h1`. Partial names start with `_`.
- No inline `<script>` or `<style>`, no `style=`, no `hx-on`, and no external asset URLs (the CSP only allows `'self'`, see T-016). JavaScript lives in `static/js/app.js`. Email templates are the only exception: they may use inline styles.
- Accessibility requirements:
  - every control has a label
  - toggles have `aria-pressed` and a descriptive `aria-label`
  - status is shown by symbol or shape, not by color alone
  - focus is visible (`:focus-visible`)
  - board tap targets are at least 36 px
  - tables have a `caption` and `th` elements with `scope`
- Design mobile-first: no horizontal page scroll at 360 px.
- A vendored asset changes only together with a new SHA-256 in `static/vendor/README.md`.

## HTMX conventions
- Every `hx-post` sits on a real `<form method="post" action="...">` that uses the same URL and includes `{% csrf_token %}`.
- The view returns a `_partial.html` when `core.http.is_htmx(request)` is true, and redirects to a safe `next` otherwise.
- HTMX is only an enhancement: every flow must also work with JavaScript disabled.
- htmx doesn't swap 4xx responses. A rejected action leaves the page unchanged; never rely on error partials being swapped in.

## Tests
- Tests are pytest functions in `<app>/tests/test_*.py`. Shared fixtures live in the root `conftest.py`.
- Control time with explicit arguments or time-machine: no sleeps, no network. Assert email through `mail.outbox`.
- Assert cross-team access as 404 and anonymous access as a login redirect. Check query budgets with `django_assert_max_num_queries`, and assert the count is the same across team sizes.
- Where HTML structure matters, parse it with BeautifulSoup instead of matching substrings.

## Security
- No secrets in the repo. `.env` is git-ignored, and Render secrets are `sync: false`.
- `csrf_exempt` is allowed only on the digest unsubscribe view (T-013).
- The admin lives at `settings.ADMIN_URL`, which must not be `admin/` in production.
- Once T-016 is done, every new route must be classified in `core/tests/test_security.py`.

## Subagents and commands
- Subagents live in `.claude/agents/` and `.opencode/agent/`: `backend`, `frontend`, `test-engineer`, `devops`, and `reviewer` (read-only).
- Commands: `/next [T-NNN]`, `/review [T-NNN]`, `/status`.

## Human-only actions
These are done by the human. Agents write the runbook steps and stop:
- creating accounts (GitHub, Render, Resend, Sentry, uptime monitor)
- DNS changes and secrets
- pushing and deploying
- approving legal text
- restore drills
- answering the open questions in `docs/plan/04-roadmap.md`

## Don'ts
- No new dependency outside a task's Scope without a written reason.
- No Celery, Redis or task queues; the hourly cron is enough (ADR-007).
- No JS frameworks and no build tools.
- No multiple teams per user, payments or native apps.
<!-- bae:end -->
