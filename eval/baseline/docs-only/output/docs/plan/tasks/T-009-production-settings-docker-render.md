---
id: T-009
title: Add production settings, a Docker image and the Render blueprint
status: pending
phase: 1
depends_on: [T-001]
size: M
risk: medium
---
## Goal
The app deploys to Render as a Docker web service with managed PostgreSQL 17. This task delivers:
- hardened production settings
- whitenoise static files and gunicorn
- optional Sentry
- a pre-deploy step that blocks insecure configuration
- a deploy runbook

The human performs the account setup and the first staging deploy.

## Context
- Read: ADR-008, ADR-003, `docs/plan/02-architecture.md` (Deployment, Security model), `config/settings.py`.
- Gotchas:
  - `SECRET_KEY` must be at least 50 characters, have at least 5 unique characters and not start with `django-insecure-`, or `check --deploy` raises W009. Make the key a manual secret (`sync: false`). Document how to generate it: `python -c "import secrets; print(secrets.token_urlsafe(64))"`.
  - `ManifestStaticFilesStorage` fails on `{% static %}` without a manifest, and tests run with `DEBUG=False`. Enable it only when `DJANGO_STATIC_MANIFEST=True` (set in the Dockerfile).
  - The Render health check may use plain HTTP, so exempt `^healthz$` from the SSL redirect.
  - Check every `render.yaml` field (`runtime`, `healthCheckPath`, `preDeployCommand`, `envVarGroups`, `databases[].postgresMajorVersion`, plan names) against Render's current Blueprint spec. Cite the docs URL in the Completion notes.
  - Install uv in the image via `COPY --from=ghcr.io/astral-sh/uv:<pinned version> /uv /uvx /bin/`, not a piped installer.

## Scope
In:
- Dependencies: `uv add gunicorn whitenoise "sentry-sdk[django]"`
- `config/settings.py`:
  - whitenoise middleware directly after `SecurityMiddleware`
  - `STORAGES` with `CompressedManifestStaticFilesStorage` when `DJANGO_STATIC_MANIFEST`
  - `CSRF_TRUSTED_ORIGINS` (`DJANGO_CSRF_TRUSTED_ORIGINS`)
  - `CONN_MAX_AGE` (`DJANGO_CONN_MAX_AGE`, default 60) and `CONN_HEALTH_CHECKS=True`
  - when `not DEBUG`:
    - `SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")`
    - `SECURE_SSL_REDIRECT` (`DJANGO_SECURE_SSL_REDIRECT`, default True) and `SECURE_REDIRECT_EXEMPT = [r"^healthz$"]`
    - `SESSION_COOKIE_SECURE` and `CSRF_COOKIE_SECURE`
    - `SECURE_HSTS_SECONDS` (`DJANGO_HSTS_SECONDS`, default 3600), `SECURE_HSTS_INCLUDE_SUBDOMAINS=True`
    - `SILENCED_SYSTEM_CHECKS = ["security.W021"]` (HSTS preload, with a comment explaining why)
  - Sentry init only if `SENTRY_DSN`: `send_default_pii=False`, `traces_sample_rate` (`SENTRY_TRACES_SAMPLE_RATE`, default 0.0), `environment` (`SENTRY_ENVIRONMENT`, default "production")
- `Dockerfile`:
  - `python:3.12-slim`; `PYTHONDONTWRITEBYTECODE=1`, `PYTHONUNBUFFERED=1`, `UV_COMPILE_BYTECODE=1`, `UV_LINK_MODE=copy`
  - `uv sync --locked --no-dev`, then copy the source
  - `collectstatic --noinput` with `DJANGO_STATIC_MANIFEST=True`
  - non-root user; `PATH` includes `/app/.venv/bin`
  - `CMD` gunicorn `config.wsgi:application` bound to `0.0.0.0:${PORT:-8000}`, workers `${WEB_CONCURRENCY:-2}`, access log to stdout
- `.dockerignore` (`.git`, `.venv`, `.bae`, `db.sqlite3`, `.env`, caches, `staticfiles`, `docs`)
- `render.yaml`:
  - env var group `teamhabits-shared`: `DJANGO_DEBUG=False`, `DJANGO_SECRET_KEY` (sync false), `DJANGO_ALLOWED_HOSTS` (sync false), `DJANGO_CSRF_TRUSTED_ORIGINS` (sync false), `SENTRY_DSN` (sync false), `DJANGO_STATIC_MANIFEST=True`
  - web service `teamhabits-web`: runtime docker, `healthCheckPath: /healthz`, `preDeployCommand: python manage.py check --deploy --fail-level WARNING && python manage.py migrate --noinput`, `DATABASE_URL` from the database
  - database `teamhabits-db`: PostgreSQL 17
- `docs/runbooks/deploy.md`: prerequisites, first staging deploy step by step, env var table, how to roll back (Render: redeploy the previous deploy), how to open a Django shell on Render, cost estimate with a "verify current pricing" note
- `.env.example` (new variables)
- `core/tests/test_production_settings.py`: runs `manage.py check --deploy --fail-level WARNING` in a subprocess with production env vars and asserts exit code 0. A second case with the default secret key asserts a non-zero exit.

Out: email provider settings (T-010), cron job (T-012), DB cache table (T-016), custom domain and HSTS raise (T-018), actually deploying (human).

## Steps
1. Settings changes, with tests that use `subprocess.run([sys.executable, "manage.py", "check", "--deploy", "--fail-level", "WARNING"], env=...)`.
2. Dockerfile and `.dockerignore`; build locally.
3. `render.yaml` checked against Render's docs, then the runbook.

## Acceptance criteria
- [ ] With production env vars (`DEBUG=False`, a 50+ character key, hosts, CSRF origins), `check --deploy --fail-level WARNING` exits 0.
- [ ] With the default development key, `check --deploy --fail-level WARNING` exits non-zero (asserted in a test).
- [ ] Tests and default dev settings do not enable manifest storage. With `DJANGO_STATIC_MANIFEST=True`, `collectstatic` succeeds and writes `staticfiles/staticfiles.json`.
- [ ] `docker build` succeeds, and running `python manage.py check` inside the image exits 0 as a non-root user.
- [ ] `/healthz` is exempt from the SSL redirect: a test with `DEBUG=False` and `SECURE_SSL_REDIRECT=True` gets 200 over plain HTTP for `/healthz` and 301 for `/`.
- [ ] Sentry initializes only when `SENTRY_DSN` is set, with `send_default_pii=False` (checked by reading the settings code; no network in tests).
- [ ] `render.yaml`:
  - [ ] declares the web service, the database (PostgreSQL 17) and the env group
  - [ ] contains no secret values
  - [ ] has a `preDeployCommand` that runs `check --deploy` before `migrate`
- [ ] `docs/runbooks/deploy.md` covers the first deploy, env vars, secret key generation, rollback and the cost check.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest --cov
env DJANGO_DEBUG=False DJANGO_SECRET_KEY=verification-only-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH DJANGO_ALLOWED_HOSTS=teamhabits.example.com DJANGO_CSRF_TRUSTED_ORIGINS=https://teamhabits.example.com uv run python manage.py check --deploy --fail-level WARNING
env DJANGO_STATIC_MANIFEST=True uv run python manage.py collectstatic --noinput
docker build -t teamhabits:verify .
docker run --rm teamhabits:verify python manage.py check
test -f render.yaml
test -f docs/runbooks/deploy.md
```
Every command exits 0. The two Docker lines need Docker; if the agent has none, mark those two lines "run by human" in the Completion notes and do not mark the task done until the human confirms they pass.

## Risks and notes
- Render plan names and blueprint fields change over time. Check them against current docs rather than memory.
- Human action after this task: create the Render services from the blueprint, set the `sync: false` secrets, deploy staging, and confirm `/healthz` returns 200.
