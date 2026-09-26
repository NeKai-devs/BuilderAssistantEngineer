# TeamHabits — Architecture

## Overview
TeamHabits is one Django 5.2 LTS project, rendered on the server, with htmx for in-place updates (ADR-001). Every environment runs the same Docker image:
- a web service
- an hourly cron job that sends digests
- a managed PostgreSQL 17 database

Local development and tests use SQLite (ADR-003).

```
Browser ──HTTPS──▶ Render web (gunicorn + Django + whitenoise) ──▶ PostgreSQL 17
                                  ▲                                     ▲
Render cron (hourly :05) ── send_weekly_digests ──────────────────────┘
                                  │
                                  └──▶ Resend (django-anymail) ──▶ member inboxes
Optional: Sentry (errors) · uptime monitor on /healthz
```

## Apps and responsibilities
| App | Owns | Key modules |
|---|---|---|
| `core` | landing, `/healthz`, legal pages, cross-cutting helpers | `dates.py` (the only module that turns the clock into dates), `streaks.py`, `http.py` (`is_htmx`, `safe_next_url`), `email.py`, `checks.py`, `converters.py` |
| `accounts` | custom `User`, sign-up form, account settings, account deletion | `models.py`, `forms.py`, `services.py` |
| `teams` | `Team`, `Membership`, invites, team administration | `middleware.py` (`request.team`), `access.py` (`team_required`, `owner_required`), `services.py` |
| `habits` | `Habit`, `HabitLog`, logging, the board, demo data | `services.py`, `selectors.py`, `board.py` |
| `digest` | weekly summary, rendering, sending, unsubscribe, `DigestDelivery` | `summary.py`, `emails.py`, `sending.py`, `unsubscribe.py` |

Dependencies point one way: `core` ← `accounts` ← `teams` ← `habits` ← `digest`. `core/dates.py` and `core/streaks.py` import nothing from the other apps.

## Data model
| Table | Fields | Constraints |
|---|---|---|
| `accounts_user` | email, password, display_name (≤ 60), weekly_digest_enabled (T-012), is_staff, is_active, date_joined, last_login | case-insensitive unique email (`Lower("email")`) |
| `account_emailaddress` (allauth) | user, email, verified, primary | allauth defaults |
| `teams_team` | name, timezone (IANA), invite_token, created_at | unique invite_token |
| `teams_membership` | team, user, role (owner/member), joined_at | `one_team_per_user` (unique user); `one_owner_per_team` (unique team where role = owner) |
| `habits_habit` | team, owner (user), name, created_at, archived_at (nullable) | index on (team, archived_at) |
| `habits_habitlog` | habit, day (team-local date), created_at | `habits_habitlog_one_per_day` (unique habit, day) |
| `digest_digestdelivery` | user, team, week_start, status (sending/sent/failed), attempts, last_error, created_at, updated_at | `digest_delivery_one_per_user_week` (unique user, week_start) |
| `django_cache` | database cache table for rate limits in production (T-016) | — |

Storage rules:
- Timestamps are stored in UTC.
- `HabitLog.day` and `DigestDelivery.week_start` are team-local calendar dates (ADR-006).
- Deleting a user cascades to their memberships, habits, logs, deliveries and email addresses.
- Deleting a team cascades to its memberships and habits.

## Request flow
Middleware order:
1. `SecurityMiddleware`
2. `WhiteNoiseMiddleware` (T-009)
3. `SessionMiddleware`
4. `CommonMiddleware`
5. `CsrfViewMiddleware`
6. `AuthenticationMiddleware`
7. allauth `AccountMiddleware`
8. `teams.middleware.CurrentTeamMiddleware`
9. `MessageMiddleware`
10. `XFrameOptionsMiddleware`
11. `csp.middleware.CSPMiddleware` (T-016)

`CurrentTeamMiddleware` sets `request.team` and `request.membership` as lazy objects. They are `None` for anonymous users and for users without a team, so pages that don't need them cost no query.

Access decorators (`teams/access.py`):
- `team_required`: anonymous users go to login, users without a team go to onboarding.
- `owner_required`: same as `team_required`, plus 403 for non-owners.

Views look objects up through `request.team`, so objects from another team return 404.

## Key flows
- **Logging (T-007).**
  1. The form sends `POST /habits/<pk>/days/<yyyy-mm-dd>/` with `done=1|0`.
  2. The service `set_done` checks the window, the creation date and the archive state, then runs `get_or_create` or `delete`.
  3. An htmx request gets back the cell partial; a plain form POST gets a redirect.
- **Board (T-008).** `build_board` makes a fixed set of queries:
  - members with their users
  - habits visible that week (SQL bounds widened by one day, then exact filtering in Python)
  - logs for `[week_end - 365, week_end]`

  It then computes the rows in Python. Budget: at most 8 queries per request, including session and auth.
- **Digest (T-011, T-012).** The hourly cron runs `send_weekly_digests`:
  1. For every team, compute the local time. The team is due on Monday once the local hour is 8 or later.
  2. Build `build_team_week` once per team (at most 4 queries).
  3. For each eligible recipient, claim a `DigestDelivery` inside a transaction, render the email, send it outside the transaction, and mark the row `sent` or `failed`.
  4. Retry `failed` rows with a conditional update; never retry `sending` rows.

## Configuration
All configuration comes from environment variables, read by django-environ in `config/settings.py`.

| Variable | Default (dev) | Introduced |
|---|---|---|
| `DJANGO_DEBUG` | False (`.env.example` sets True) | T-001 |
| `DJANGO_SECRET_KEY` | `django-insecure-…` (rejected by `check --deploy`) | T-001 |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1` | T-001 |
| `DATABASE_URL` | `sqlite:///db.sqlite3` | T-001 |
| `DJANGO_EMAIL_BACKEND` | console | T-001 |
| `DJANGO_ADMIN_URL` | `admin/` | T-001 |
| `DJANGO_LOG_LEVEL` | INFO | T-001 |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | empty | T-009 |
| `DJANGO_CONN_MAX_AGE` | 60 | T-009 |
| `DJANGO_SECURE_SSL_REDIRECT` | True when not DEBUG | T-009 |
| `DJANGO_HSTS_SECONDS` | 3600 (31536000 at launch) | T-009 |
| `DJANGO_STATIC_MANIFEST` | False (True in the image) | T-009 |
| `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_ENVIRONMENT` | unset, 0.0, production | T-009 |
| `RESEND_API_KEY`, `DEFAULT_FROM_EMAIL`, `SITE_URL` | unset, `TeamHabits <no-reply@localhost>`, `http://localhost:8000` | T-010 |
| `DJANGO_CACHE_URL` | `locmemcache://` (`dbcache://django_cache` in production) | T-016 |

## Deployment
Render deploys from the blueprint in `render.yaml` (ADR-008):
- env var group `teamhabits-shared`; secrets are `sync: false`
- web service `teamhabits-web`
- cron job `teamhabits-digest` (`5 * * * *`)
- database `teamhabits-db` (PostgreSQL 17)

The pre-deploy command runs `check --deploy --fail-level WARNING && createcachetable && migrate --noinput`, and the health check is `/healthz`.

Environments: until launch, the services act as staging on the `onrender.com` hostname. At launch the custom domain is attached (T-018).

## Security model
- **Authentication:** allauth with email and password; sessions last 30 days. Rate limits are shared across workers through the database cache (T-016).
- **Authorization:** team scoping as described above. Cross-team requests get 404; non-owners get 403 on owner actions. `core/tests/test_security.py` checks that every route is classified (T-016).
- **Transport and cookies:** SSL redirect (`/healthz` exempt), HSTS, secure session and CSRF cookies.
- **Content:** CSP `default-src 'self'` with no inline scripts or styles. Only the digest preview page relaxes `style-src`. Also `X-Frame-Options: DENY` and `Referrer-Policy: same-origin`.
- **CSRF:** on every POST. The only exemption is the digest unsubscribe view, where the signed token is the authorization.
- **Secrets:** environment variables only. The admin is at `DJANGO_ADMIN_URL`. `check_launch` validates the production configuration (T-018).
- **Supply chain:** dependencies are locked in `uv.lock` and audited in CI (T-016). Vendored assets are pinned by SHA-256.

## Observability
- Logs go to stdout, where Render collects them.
- The digest run logs one INFO summary line.
- Sentry is optional and runs without personal data.
- `/healthz` runs `SELECT 1`, and an external uptime monitor checks it every 5 minutes.
- The Django admin is used to inspect `DigestDelivery` rows.

## Testing strategy
- **Unit tests:** dates, streaks, services, `build_board`, `build_team_week`, token helpers.
- **View tests:** permission matrices, HTMX versus plain-form behaviour, query budgets, HTML structure checked with BeautifulSoup.
- **Command tests:** `seed_demo`, `send_weekly_digests` with an explicit `--now`, `check_launch`.
- **CI:** all gates on SQLite, plus the full suite on PostgreSQL 17.
- **Manual:** `docs/qa/manual-checklist.md` at 360×740 and at 200% zoom. There is no browser automation (risk R-7).

## Repository layout
```
AGENTS.md  CLAUDE.md  README.md  Makefile  pyproject.toml  uv.lock  .python-version
manage.py  conftest.py  .env.example  .gitignore
Dockerfile  .dockerignore  render.yaml               (T-009)
.github/workflows/ci.yml                             (T-002)
config/  core/  accounts/  teams/  habits/  digest/
templates/  static/css/  static/js/  static/vendor/
docs/plan/  docs/runbooks/  docs/qa/
```
