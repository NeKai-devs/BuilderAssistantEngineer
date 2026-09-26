---
id: T-013
title: Add digest preferences and one-click unsubscribe
status: pending
phase: 2
depends_on: [T-012]
size: S
risk: medium
---
## Goal
Members control the Monday email from `/account/settings/`. Every digest carries:
- a signed unsubscribe link
- RFC 8058 headers (`List-Unsubscribe`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`), so mail clients' one-click unsubscribe works

This improves deliverability and respects users.

## Context
- Read: ADR-007, `digest/sending.py`, `digest/emails.py`, `accounts/models.py`, `docs/plan/01-prd.md` (US-8, FR-7).
- Gotchas:
  - GET must not change state, because link scanners prefetch URLs. GET shows a confirmation; POST applies it.
  - One-click POSTs from mail providers carry no CSRF token. `csrf_exempt` is allowed only on this view; the signed token is the authorization.
  - Tokens use `django.core.signing.dumps({"u": user.pk}, salt="digest.unsubscribe")` with no expiry (old emails must keep working).

## Scope
In:
- `digest/unsubscribe.py`: `make_unsubscribe_token(user) -> str`, `read_unsubscribe_token(token) -> int | None`, `unsubscribe_url(user) -> str` (absolute, from `SITE_URL`)
- `digest/views.py`: `unsubscribe` at `/digest/unsubscribe/<str:token>/`
  - GET: confirmation page with the masked email and a POST button
  - POST (`csrf_exempt`): sets `weekly_digest_enabled=False`, then shows a done page linking to settings
  - invalid token or unknown user → 400 page
- `digest/sending.py`: pass `unsubscribe_url` to the renderer and add both headers
- `accounts/forms.py`: `PreferencesForm` (`weekly_digest_enabled`)
- `accounts/views.py`: `settings_view` at `/account/settings/` (`accounts:settings`, `@login_required`), showing the preference toggle and a link to `/digest/preview/` for members
- `accounts/urls.py` (`app_name = "accounts"`), included in `config/urls.py` under `account/`
- Templates: `accounts/templates/accounts/settings.html`, `digest/templates/digest/unsubscribe_{confirm,done,invalid}.html`
- `templates/_nav.html` ("Account")
- Tests: `digest/tests/test_unsubscribe.py`, `accounts/tests/test_settings.py`

Out: display name and account deletion (T-015).

## Steps
1. Write the token helpers (`make_unsubscribe_token`, `read_unsubscribe_token`, `unsubscribe_url`) with round-trip and tampering tests.
2. Build the unsubscribe view and its confirm, done and invalid templates: GET confirms, POST applies (`csrf_exempt`), and bad tokens get the 400 page.
3. Pass `unsubscribe_url` to the renderer in `send_due_digests`, and add both RFC 8058 headers.
4. Add `PreferencesForm`, `settings_view`, `accounts/urls.py` and the "Account" nav item.
5. Write the tests in the Acceptance criteria.

## Acceptance criteria
- [ ] `/account/settings/`: anonymous users → login redirect. A POST toggling the checkbox updates `weekly_digest_enabled` and redirects with a message.
- [ ] Tokens: a round trip returns the user id; a tampered token returns `None` and the view returns 400.
- [ ] GET on the unsubscribe URL leaves `weekly_digest_enabled` unchanged. POST from a client with `enforce_csrf_checks=True` and no CSRF token returns 200 and sets it to False.
- [ ] Digest emails sent by `send_due_digests` contain the header `List-Unsubscribe: <https://…/digest/unsubscribe/<token>/>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and the footer link matches.
- [ ] After unsubscribing, the next due run skips that user.
- [ ] `csrf_exempt` appears only on the unsubscribe view (checked by a test that greps the source or inspects the view attributes).

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest digest accounts -q
uv run pytest --cov
```
Every command exits 0.

## Risks and notes
- A token for a deleted user must not raise a 500. It returns the 400 page.
