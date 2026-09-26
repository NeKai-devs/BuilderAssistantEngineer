---
id: T-003
title: Add the custom user model and email-based auth with django-allauth
status: pending
phase: 1
depends_on: [T-001]
size: M
risk: medium
---
## Goal
People sign up with an email, a password and a display name, log in and out, and reset a forgotten password. In development the reset email is printed to the console. The custom user model is part of the very first project migration, so it never needs to be swapped later.

## Context
- Read: ADR-004, `docs/plan/01-prd.md` (US-1, US-2, FR-1), `config/settings.py`, `templates/base.html`.
- Gotchas:
  - `AUTH_USER_MODEL = "accounts.User"` must be set before the first project migration. Delete any local `db.sqlite3` left over from T-001.
  - allauth setting names change between versions: 65.x uses `ACCOUNT_LOGIN_METHODS` and `ACCOUNT_SIGNUP_FIELDS`, and older names are deprecated. Follow the installation docs for the installed version for the required apps and middleware (`allauth.account.middleware.AccountMiddleware`). `manage.py check --fail-level WARNING` must stay clean.
  - Don't copy every allauth template. Override its layout template (`templates/allauth/layouts/base.html`; confirm the name in the installed package) so that every allauth page extends `base.html`.
  - Logout is POST-only (allauth's default). The nav uses a small form.

## Scope
In:
- Dependencies: `uv add django-allauth`
- `accounts` app:
  - `models.py`:
    - `User(AbstractUser)` with `username = None`, `email = EmailField(unique=True)`, `display_name = CharField(max_length=60, blank=True)`
    - `USERNAME_FIELD = "email"`, `REQUIRED_FIELDS = []`, and a `UserManager` that creates users by email
    - `UniqueConstraint(Lower("email"), name="accounts_user_email_ci_unique")`
    - a `name` property: `display_name`, or the email's local part when it's blank
  - migration `0001_initial`
- `accounts/admin.py` (a `UserAdmin` adapted to email)
- `accounts/forms.py`: a sign-up form that adds `display_name` (required, stripped, 1–60 characters), wired through allauth's signup form setting for the installed version
- `config/settings.py`:
  - `INSTALLED_APPS`, middleware, `AUTHENTICATION_BACKENDS` (ModelBackend plus allauth), `AUTH_USER_MODEL`
  - `ACCOUNT_LOGIN_METHODS = {"email"}`, `ACCOUNT_SIGNUP_FIELDS = ["email*", "password1*", "password2*"]`, `ACCOUNT_USER_MODEL_USERNAME_FIELD = None`, `ACCOUNT_UNIQUE_EMAIL = True`
  - `ACCOUNT_EMAIL_VERIFICATION = "none"` (T-010 changes it to "optional")
  - `LOGIN_URL = "account_login"`, `LOGIN_REDIRECT_URL = "/"`, `ACCOUNT_LOGOUT_REDIRECT_URL = "/"`
  - `AUTH_PASSWORD_VALIDATORS`: the Django defaults, with a minimum length of 10
- `config/urls.py`: `path("accounts/", include("allauth.urls"))`
- Templates: `templates/allauth/layouts/base.html`, and `templates/_nav.html` (anonymous: Log in, Sign up; authenticated: the user's name and a Log out POST form)
- `core/views.py` and the landing template: sign-up and log-in calls to action for anonymous visitors; signed-in users see a short "You're signed in" placeholder until T-004
- Tests: `accounts/tests/test_models.py`, `accounts/tests/test_auth_flows.py`

Out: email verification and branded emails (T-010); rate limits (T-016); account settings (T-013, T-015); social login (not planned).

## Steps
1. Create the app and the custom user, set `AUTH_USER_MODEL`, and generate the initial migration.
2. Install and configure allauth for email-only login, with the sign-up form that collects the display name.
3. Add the layout override and the nav.
4. Write tests for sign-up, login, logout, password reset and case-insensitive email uniqueness.

## Acceptance criteria
- [ ] `get_user_model()` is `accounts.User`. `create_user(email=..., password=...)` works without a username, and `createsuperuser` asks for an email.
- [ ] Signing up with email, display name and password creates the user, logs them in and redirects to `/`.
- [ ] Signing up as `Alice@Example.com` when `alice@example.com` exists fails with a form error. The database constraint also rejects the duplicate.
- [ ] A blank display name, or one longer than 60 characters, shows a form error.
- [ ] Login with email and password works, and a wrong password shows an error. Logout is POST-only and returns to `/`.
- [ ] Password reset sends one email (`mail.outbox`) with a working reset link, and following the link sets a new password.
- [ ] `User.name` returns `display_name`, or the email's local part when `display_name` is blank.
- [ ] The allauth pages used (login, sign-up, logout, the password reset flow) render inside `base.html`, with the nav and skip link, and contain no inline scripts or `style=` attributes.
- [ ] `manage.py check --fail-level WARNING` reports no deprecated allauth settings.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest accounts -q
uv run pytest --cov
```
Every command exits 0.

## Risks and notes
- If allauth's default element templates include inline scripts or styles, override those specific templates now rather than waiting for T-016.
