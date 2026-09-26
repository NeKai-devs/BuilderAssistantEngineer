---
id: T-018
title: "Prepare launch: runbooks, backups, monitoring, legal pages, check_launch"
status: pending
phase: 3
depends_on: [T-015, T-016]
size: M
risk: low
---
## Goal
Everything needed to launch production on 2026-11-06 and run it solo:
- a launch checklist
- a `check_launch` command that validates the production configuration
- backup and restore, and incident runbooks
- privacy and terms pages (drafts for the owner to review)
- a final README

## Context
- Read: `docs/runbooks/*.md`, ADR-008, ADR-007, `core/tests/test_security.py` (route classification: new public routes must be added), `docs/plan/01-prd.md` (US-12, non-functional requirements: privacy).
- The privacy page must describe what actually happens:
  - stored: email, display name, team, habits, logs, delivery records
  - emails sent: verification, password reset, weekly digest
  - processors: Render (hosting and database), Resend (email), Sentry (errors, if enabled)
  - no analytics or tracking
  - self-service deletion
  
  Mark both pages "Draft — review before launch; not legal advice".

## Scope
In:
- `core/management/commands/check_launch.py` validates, and reports every problem before exiting 1 if any exist:
  - `DEBUG` is False
  - `SITE_URL` starts with `https://`
  - `EMAIL_BACKEND` is an Anymail backend
  - `DEFAULT_FROM_EMAIL` domain is not `localhost` or `example.com`
  - `SECURE_HSTS_SECONDS >= 31536000`
  - `SENTRY_DSN` is set
  - `ADMIN_URL != "admin/"`
  - the cache backend is the database cache
  - `ALLOWED_HOSTS` doesn't contain `*`
- `core/views.py` and `core/urls.py`: `privacy` and `terms` (public); templates `core/templates/core/{privacy,terms}.html`; footer links in `base.html`; classification entries in `core/tests/test_security.py`
- `docs/runbooks/launch.md`, in order:
  1. custom domain on Render
  2. verify HTTPS
  3. raise `DJANGO_HSTS_SECONDS` to 31536000
  4. set `SITE_URL`, `DJANGO_ADMIN_URL`, `SENTRY_DSN`
  5. `check_launch` in the Render shell
  6. `createsuperuser`
  7. uptime monitor on `/healthz` (free tier, 5-minute interval, alert to the owner's email)
  8. first-Monday watch plan
  9. rollback steps
- `docs/runbooks/backup-restore.md`:
  - confirm the Render Postgres backup retention for the chosen plan
  - weekly manual `pg_dump` to encrypted local storage
  - a restore drill into a new database, with the verification query set
  - a table to record drill dates
- `docs/runbooks/incident.md`: site down, digest failed or missing, suspected data leak (rotate secrets, invalidate sessions via `SECRET_KEY` rotation, notify users)
- `README.md`: final version (product, local development, commands, deploy and runbook links, plan links)
- Tests: `core/tests/test_check_launch.py`, `core/tests/test_legal_pages.py`

Out: the actual production deploy, DNS and monitors (human); professional legal review (owner's responsibility).

## Steps
1. Write `check_launch` with one parametrized test per rule using `override_settings`. It reports every problem before exiting.
2. Add the privacy and terms pages, the footer links, and their entries as public routes in `core/tests/test_security.py`.
3. Write the runbooks: `launch.md`, `backup-restore.md`, `incident.md`.
4. Write the final `README.md`.
5. Run the Verification block, and list the human actions with target dates in `launch.md`.

## Acceptance criteria
- [ ] `check_launch` exits 0 with a fully production-like configuration (see Verification). Each rule, when violated, is reported by name and the command exits 1 (one parametrized test per rule using `override_settings`).
- [ ] `/privacy/` and `/terms/` return 200 to anonymous users, are linked from the footer on every page, contain the draft notice, and name Render, Resend and Sentry.
- [ ] The route classification test in `core/tests/test_security.py` passes with the new routes listed as public.
- [ ] `launch.md`, `backup-restore.md` and `incident.md` exist and cover the items in Scope. `README.md` links to the runbooks and the plan.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest core -q
uv run pytest --cov
env DJANGO_DEBUG=False DJANGO_SECRET_KEY=verification-only-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH DJANGO_ALLOWED_HOSTS=teamhabits.example.com DJANGO_CSRF_TRUSTED_ORIGINS=https://teamhabits.example.com DJANGO_HSTS_SECONDS=31536000 DJANGO_ADMIN_URL=ops-4f9c/ DJANGO_CACHE_URL=dbcache://django_cache SITE_URL=https://teamhabits.example.com RESEND_API_KEY=re_verification_dummy DEFAULT_FROM_EMAIL=hello@teamhabits.org SENTRY_DSN=https://public@o0.ingest.sentry.io/0 uv run python manage.py check_launch
test -f docs/runbooks/launch.md
test -f docs/runbooks/backup-restore.md
test -f docs/runbooks/incident.md
```
Every command exits 0. `check_launch` prints "launch checks passed".

## Risks and notes
- Human actions: custom domain, HSTS raise, monitors, restore drill, legal text approval, production deploy. Record the dates in `launch.md`.
- Don't raise HSTS to one year before HTTPS on the custom domain is confirmed.
