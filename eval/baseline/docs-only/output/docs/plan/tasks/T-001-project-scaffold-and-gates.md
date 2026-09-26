---
id: T-001
title: Scaffold the Django project with uv, tooling and quality gates
status: pending
phase: 1
depends_on: []
size: M
risk: low
---
## Goal
Create a runnable Django 5.2 LTS project that every later task builds on:
- dependencies managed by uv, with a committed `uv.lock`
- ruff for linting and formatting, mypy with django-stubs, and pytest with pytest-django and an 85% coverage gate
- `make check` running the standard gates from AGENTS.md
- one settings module driven by environment variables (SQLite by default, `DATABASE_URL` when set)
- a base layout with vendored htmx 2 and Pico.css 2, a public landing page and `/healthz`

## Context
- Read: `AGENTS.md` (Stack, Commands, Standard gates, Templates and CSS), ADR-001, ADR-002, ADR-003, `docs/plan/02-architecture.md` (Repository layout).
- Gotchas:
  - The custom user model comes in T-003 and must be in the first project migration. Create no models here, and delete any local `db.sqlite3` before T-003.
  - By default htmx 2 injects an inline indicator `<style>`. Add `<meta name="htmx-config" content='{"includeIndicatorStyles": false}'>` to `base.html` so the strict CSP in T-016 needs no exception.
  - `DEBUG` defaults to False, and `.env.example` sets `DJANGO_DEBUG=True` for local work. The default secret key starts with `django-insecure-` on purpose: T-009 asserts that `check --deploy` rejects it.
  - Vendoring needs network access. Take the files from the official releases, and record the version, source URL, license and SHA-256 of each.
- Keep the existing `.gitignore` and `docs/idea.md`. Extend `.gitignore` and replace `README.md`.

## Scope
In:
- `pyproject.toml` (no package build; `requires-python = ">=3.12,<3.13"`), `.python-version` (`3.12`), `uv.lock`
  - dependencies: `django>=5.2,<5.3`, `django-environ`, `psycopg[binary]`, `tzdata`
  - dev group: `pytest`, `pytest-django`, `pytest-cov`, `ruff`, `mypy`, `django-stubs[compatible-mypy]`, `beautifulsoup4`
  - `[tool.ruff]`: `target-version = "py312"`, line length 100, rules `E, W, F, I, B, UP, S, DJ, SIM, RUF`; `S101` ignored under `*/tests/*`
  - `[tool.mypy]`: `strict = true`, django-stubs plugin with `django_settings_module = "config.settings"`; overrides allow untyped defs in `*.tests.*` and ignore errors in `*.migrations.*`
  - `[tool.pytest.ini_options]`: `DJANGO_SETTINGS_MODULE = "config.settings"`, `python_files = ["test_*.py"]`, `addopts = "--strict-markers"`
  - `[tool.coverage]`:
    - `branch = true`, `source = ["."]`
    - omit `*/migrations/*`, `*/tests/*`, `conftest.py`, `manage.py`, `config/asgi.py`, `config/wsgi.py`, `.venv/*`
    - `fail_under = 85`, `show_missing = true`
- `manage.py`, `config/__init__.py`, `config/settings.py`, `config/urls.py`, `config/wsgi.py`, `config/asgi.py`
- `config/settings.py` (django-environ; reads `.env` when present):
  - `DEBUG` (`DJANGO_DEBUG`, default False), `SECRET_KEY` (`DJANGO_SECRET_KEY`, default `django-insecure-dev-only-change-me`), `ALLOWED_HOSTS` (`DJANGO_ALLOWED_HOSTS`, default `localhost,127.0.0.1`)
  - `DATABASES = {"default": env.db("DATABASE_URL", default=<sqlite db.sqlite3 in BASE_DIR>)}`
  - `USE_TZ = True`, `TIME_ZONE = "UTC"`, `LANGUAGE_CODE = "en"`
  - `EMAIL_BACKEND` (`DJANGO_EMAIL_BACKEND`, default console), `ADMIN_URL` (`DJANGO_ADMIN_URL`, default `admin/`)
  - `TEMPLATES` with `DIRS = [BASE_DIR / "templates"]`; `STATIC_URL = "static/"`, `STATICFILES_DIRS = [BASE_DIR / "static"]`, `STATIC_ROOT = BASE_DIR / "staticfiles"`
  - `LOGGING`: console handler to stdout, at level `DJANGO_LOG_LEVEL` (default INFO)
- `core` app (`apps.py`, `urls.py` with `app_name = "core"`, `views.py`):
  - `landing` at `/` (`core:landing`)
  - `healthz` at `/healthz` (`core:healthz`, no trailing slash): runs `SELECT 1` and returns 200 `text/plain` `ok`, or 503 when the database fails
- `config/urls.py`: admin at `settings.ADMIN_URL`, plus `core.urls`
- Templates:
  - `templates/base.html`:
    - `<html lang="en">`, the viewport meta and the htmx-config meta
    - `static/vendor/pico.min.css`, `static/css/app.css`, and `static/vendor/htmx.min.js` with `defer`
    - a skip link to `#content`, `{% include "_nav.html" %}`, `{% include "_messages.html" %}`
    - `<main id="content">` with the `head_title` and `content` blocks
  - `templates/_nav.html` (only the brand link for now), `templates/_messages.html`, `templates/404.html`, `templates/500.html`
  - `core/templates/core/landing.html` (the product pitch, one `h1`)
- `static/css/app.css`, `static/vendor/htmx.min.js` (latest 2.0.x), `static/vendor/pico.min.css` (latest 2.x), `static/vendor/README.md`
- `Makefile`: `install`, `run`, `migrate`, `fmt`, `lint`, `typecheck`, `test`, `check` (the standard gates, in AGENTS.md order)
- `conftest.py` (root; shared fixtures start here)
- `.env.example`, `.gitignore` (add `.venv/`, `db.sqlite3`, `.env`, `staticfiles/`, `.coverage`, `htmlcov/`, `.mypy_cache/`, `.ruff_cache/`, `.pytest_cache/`)
- `README.md`: what the app is, local setup (install uv, `make install`, `cp .env.example .env`, `make migrate`, `make run`), `make check`, links to `AGENTS.md` and `docs/plan/`
- `core/tests/test_smoke.py`

Out: the user model and auth (T-003); CI (T-002); production settings, Docker and Render (T-009); the CSP (T-016).

## Steps
1. Initialize the uv project and add the dependencies with `uv add` and `uv add --dev`.
2. Run `django-admin startproject config .`, create the `core` app, then rewrite the settings around django-environ.
3. Add the base templates, the landing page and healthz. Vendor htmx and Pico, and record the `sha256sum` output.
4. Add the tool configuration, Makefile, README and smoke tests, then run the gates.

## Acceptance criteria
- [ ] `uv sync --locked` succeeds from a clean clone, and `uv.lock` is committed.
- [ ] `make check` runs the standard gates in AGENTS.md order and exits 0.
- [ ] `GET /` returns 200 with `<html lang="en">`, exactly one `h1`, a skip link to `#content`, and the vendored Pico and htmx files referenced under `/static/vendor/`.
- [ ] `GET /healthz` returns 200 `text/plain` with body `ok` to anonymous users. With the database cursor patched to raise, it returns 503.
- [ ] An unknown URL returns 404, rendered from `templates/404.html`.
- [ ] No template contains an inline `<script>` or `<style>` block, a `style=` attribute or an external asset URL.
- [ ] `static/vendor/README.md` lists the version, source URL, license and SHA-256 of each vendored file, and each checksum matches `sha256sum`.
- [ ] Coverage is configured with branch coverage and `fail_under = 85`, excluding migrations and tests.
- [ ] Without `DATABASE_URL` the app uses `db.sqlite3`. `.env.example` documents every variable the settings read.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest --cov
make check
test -f static/vendor/README.md
sha256sum static/vendor/htmx.min.js static/vendor/pico.min.css
```
Every command exits 0. The `sha256sum` output matches `static/vendor/README.md`.

## Risks and notes
- Without network access, the human downloads the two vendored files. Record this in the Completion notes.
- Keep a single settings module; environments differ only by environment variables (ADR-002).
