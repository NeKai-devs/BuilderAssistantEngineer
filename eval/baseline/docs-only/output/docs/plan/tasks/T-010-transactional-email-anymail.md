---
id: T-010
title: Configure transactional email with Anymail and shared templates
status: pending
phase: 2
depends_on: [T-003, T-009]
size: M
risk: medium
---
## Goal
Email setup per environment:
- production sends real email through Resend via django-anymail
- development uses the console backend; tests use locmem

A helper renders every email as text plus HTML from templates. Allauth emails (verification, password reset) use the branded templates. Email verification becomes "optional", with a banner nudging unverified users. A deploy check makes sure production can't run with a fake email backend.

## Context
- Read: ADR-007, ADR-004, `config/settings.py`, `templates/base.html`, `docs/runbooks/deploy.md`.
- Gotchas:
  - Allauth email template names differ by version. List the installed ones under `.venv/lib/python3.12/site-packages/allauth/templates/account/email/` and override exactly those you need (at least email confirmation and password reset: subject, text and HTML).
  - Register the system check with `@register(Tags.security, deploy=True)` so it only runs under `check --deploy`. Normal dev and test checks use console or locmem backends.
  - Email HTML may use inline styles (the exception noted in AGENTS.md); app pages may not.
  - Links in emails sent from cron jobs have no request. Add `SITE_URL` (`env("SITE_URL", default="http://localhost:8000")`) for absolute URLs.

## Scope
In:
- Dependencies: `uv add "django-anymail[resend]"`
- `config/settings.py`:
  - if `RESEND_API_KEY` is set: `EMAIL_BACKEND = "anymail.backends.resend.EmailBackend"` and `ANYMAIL = {"RESEND_API_KEY": ...}`
  - otherwise keep `DJANGO_EMAIL_BACKEND` (console by default)
  - `DEFAULT_FROM_EMAIL` and `SERVER_EMAIL` (`DEFAULT_FROM_EMAIL`, default `TeamHabits <no-reply@localhost>`), `SITE_URL`
  - `ACCOUNT_EMAIL_VERIFICATION = "optional"`, `ACCOUNT_EMAIL_SUBJECT_PREFIX = "TeamHabits: "`
- `core/email.py`: `send_templated_email(*, to: list[str], subject: str, template: str, context: dict[str, object], headers: dict[str, str] | None = None) -> None`, which renders `<template>.txt` and `<template>.html` and sends `EmailMultiAlternatives`, raising on failure
- `core/checks.py`: deploy check `core.E001` (not DEBUG and a console, locmem, dummy or filebased backend → Error), registered in `CoreConfig.ready()`
- `templates/email/base.txt`, `templates/email/base.html`, and the allauth `templates/account/email/*` overrides
- `accounts/context_processors.py`: `email_status` exposes a lazy `email_verified` (at most one query, and only when the template reads it); registered in `TEMPLATES`
- `templates/_verify_banner.html`, included in `base.html` for authenticated, unverified users, with a link to `account_email`
- `render.yaml`: add `RESEND_API_KEY` and `DEFAULT_FROM_EMAIL` (sync false) and `SITE_URL` (sync false) to `teamhabits-shared`
- `.env.example`
- `docs/runbooks/email.md`: Resend account, adding the domain, the SPF/DKIM records Resend shows, DMARC `v=DMARC1; p=none; rua=mailto:<owner>`, sending a test email via `uv run python manage.py sendtestemail <address>`, and what to do while the domain is still unverified
- Tests: `core/tests/test_email.py`, `core/tests/test_checks.py`, `accounts/tests/test_verification.py`

Out: digest content (T-011), sending logic (T-012), unsubscribe (T-013).

## Steps
1. Settings, the helper and the check.
2. Base email templates and the allauth overrides (brand name, plain layout, table-free simple HTML).
3. Context processor and banner.
4. `render.yaml`, `.env.example`, runbook, tests.
5. Update the deploy check command in `docs/runbooks/deploy.md` to include the new env vars.

## Acceptance criteria
- [ ] `send_templated_email` sends one message with the subject, a text body and one `text/html` alternative. Custom headers are present on the message.
- [ ] Sign-up sends one confirmation email; the user is logged in without confirming ("optional").
- [ ] The password reset email renders from the overridden templates (the test asserts the brand string and the reset link).
- [ ] An unverified user sees the verify banner on `/habits/`. After `EmailAddress.verified=True` the banner is gone.
- [ ] The banner adds no query on pages for anonymous users.
- [ ] `call_command("check", "--deploy")` with `DEBUG=False` and the console backend raises `SystemCheckError` containing `core.E001`.
- [ ] With `RESEND_API_KEY` set, `settings.EMAIL_BACKEND == "anymail.backends.resend.EmailBackend"` (checked in a subprocess).
- [ ] `docs/runbooks/email.md` exists and lists the SPF, DKIM and DMARC steps and the test-send command.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest core accounts -q
uv run pytest --cov
env DJANGO_DEBUG=False DJANGO_SECRET_KEY=verification-only-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH DJANGO_ALLOWED_HOSTS=teamhabits.example.com DJANGO_CSRF_TRUSTED_ORIGINS=https://teamhabits.example.com RESEND_API_KEY=re_verification_dummy DEFAULT_FROM_EMAIL=hello@teamhabits.example.com SITE_URL=https://teamhabits.example.com uv run python manage.py check --deploy --fail-level WARNING
test -f docs/runbooks/email.md
```
Every command exits 0.

## Risks and notes
- The domain may be unverified in Resend until the DNS records propagate, which can take days. The human should start this in week 1.
- Users created before this task have unverified `EmailAddress` rows; the banner handles them.
