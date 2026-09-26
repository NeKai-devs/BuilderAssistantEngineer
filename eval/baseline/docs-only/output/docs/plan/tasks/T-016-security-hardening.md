---
id: T-016
title: "Harden security: rate limits, headers, CSP, route matrix, dependency audit"
status: pending
phase: 3
depends_on: [T-013, T-014]
size: M
risk: medium
---
## Goal
Before launch the app has:
- brute-force protection on login, sign-up and password reset that is shared across workers
- strict security headers and a CSP
- a dependency vulnerability audit in CI
- an automated test that classifies every route and proves authentication and team scoping, so future routes can't silently skip them

## Context
- Read: `docs/plan/02-architecture.md` (Security model), ADR-004, ADR-005, `config/settings.py`, `config/urls.py`, `static/vendor/README.md`.
- Gotchas:
  - Allauth rate limits use the Django cache. The per-process locmem cache doesn't share counts between gunicorn workers, so production uses the database cache (`dbcache://django_cache`), which needs `createcachetable` in the pre-deploy step.
  - django-csp 4.x uses `CONTENT_SECURITY_POLICY = {"DIRECTIVES": {...}}` (the older `CSP_*` settings are gone). Confirm against the installed version.
  - The digest preview (T-011) renders email HTML with inline styles. Relax `style-src` only for that view (django-csp's per-view decorator) and test it.
  - `pip-audit` needs `pip` or a requirements file; uv virtual environments have no `pip`. Audit an exported requirements file with `--no-deps --disable-pip` (check the flags with `uvx pip-audit --help`).

## Scope
In:
- Dependencies: `uv add django-csp`
- `config/settings.py`:
  - `CACHES = {"default": env.cache("DJANGO_CACHE_URL", default="locmemcache://")}`
  - explicit `ACCOUNT_RATE_LIMITS` (at least `login_failed`, `signup`, `reset_password`, using keys valid for the installed allauth)
  - `SECURE_REFERRER_POLICY = "same-origin"`, `X_FRAME_OPTIONS = "DENY"`, `SESSION_COOKIE_AGE = 60*60*24*30`
  - `CONTENT_SECURITY_POLICY` directives: `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self' data:`, `font-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`
- `render.yaml`: `DJANGO_CACHE_URL=dbcache://django_cache` in the shared group; `preDeployCommand` becomes `check --deploy … && createcachetable && migrate --noinput`
- `templates/429.html`
- `digest/views.py`: per-view CSP relaxation for `preview` only
- `Makefile`: `audit` target — `uv export --format requirements-txt --no-hashes --no-emit-project --output-file .audit-requirements.txt`, then `uvx pip-audit --requirement .audit-requirements.txt --no-deps --disable-pip`
- `.gitignore` (`.audit-requirements.txt`)
- `.github/workflows/ci.yml`: an audit step in `checks`
- `core/tests/test_security.py`:
  - **Route classification test:** walk `get_resolver().url_patterns` recursively, excluding the `admin` and allauth `account_*` names. Every named route must appear in exactly one of `PUBLIC`, `LOGIN_REQUIRED`, `TEAM_REQUIRED` or `OWNER_REQUIRED`, together with its sample kwargs; an unclassified route fails with the message "classify new route <name>". An anonymous GET to every non-public route redirects to login.
  - **Cross-team matrix:** a user of team B gets 404 on team A's habit edit, archive and set_day, and on remove and make-owner for team A's memberships.
  - **Headers:** `/` sends the CSP with the directives above, `X-Frame-Options: DENY` and `Referrer-Policy: same-origin`; `/digest/preview/` allows inline styles only there.
  - **Rate limit:** repeated failed logins for one account within the window are refused (HTTP 429 or allauth's rate-limit response), with the limit taken from settings.
  - **No inline scripts:** for the landing, board, habits, team and settings pages, no `<script>` without `src`, no `style=` attributes, no `hx-on` attributes.

Out: web application firewall or bot protection (not planned); 2FA (deferred).

## Steps
1. Add the cache settings, the explicit allauth rate limits and `templates/429.html`. Update the `render.yaml` shared group and the pre-deploy step to run `createcachetable`.
2. Install django-csp, configure the directives, and relax `style-src` for the digest preview only.
3. Add the referrer, frame and session settings.
4. Write `core/tests/test_security.py`: route classification with its meta-test, the cross-team matrix, headers, the rate limit, and no inline scripts. Fix every page that fails, without loosening the policy.
5. Add the `make audit` target, the `.gitignore` entry and the CI audit step, then run the audit.

## Acceptance criteria
- [ ] Every test in `core/tests/test_security.py` described in Scope passes.
- [ ] Adding a dummy named route in a test-only URLconf without classifying it makes the classification test fail (demonstrated by a meta-test using `override_settings(ROOT_URLCONF=...)`).
- [ ] Allauth rate limits are configured explicitly, and production uses the database cache via env.
- [ ] `render.yaml`'s pre-deploy step runs `createcachetable`.
- [ ] `make audit` exits 0 with no known vulnerabilities, or each accepted finding is documented with an `--ignore-vuln` flag and a justification in the Completion notes.
- [ ] CI runs the audit.
- [ ] `check --deploy --fail-level WARNING` still exits 0 with production env vars.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest core/tests/test_security.py -q
uv run pytest --cov
env DJANGO_DEBUG=False DJANGO_SECRET_KEY=verification-only-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH DJANGO_ALLOWED_HOSTS=teamhabits.example.com DJANGO_CSRF_TRUSTED_ORIGINS=https://teamhabits.example.com RESEND_API_KEY=re_verification_dummy DEFAULT_FROM_EMAIL=hello@teamhabits.example.com SITE_URL=https://teamhabits.example.com DJANGO_CACHE_URL=dbcache://django_cache uv run python manage.py check --deploy --fail-level WARNING
make audit
```
Every command exits 0. `make audit` needs network access.

## Risks and notes
- If allauth's default templates include inline scripts on any page we use, override those templates rather than loosening the CSP globally.
