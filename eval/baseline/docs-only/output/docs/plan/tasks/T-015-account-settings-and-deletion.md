---
id: T-015
title: Add account settings and account deletion
status: pending
phase: 3
depends_on: [T-013, T-014]
size: M
risk: medium
---
## Goal
`/account/settings/` lets a user:
- change their display name
- reach allauth's email and password pages
- delete their account after confirming their password

Team consequences of deletion are well defined. This covers basic privacy obligations and self-service.

## Context
- Read: `accounts/views.py` and `accounts/forms.py` (T-013), `teams/services.py` (T-014), `docs/plan/01-prd.md` (US-11), ADR-005.
- Deletion rules:
  - Owner of a team with other members → blocked, with a link to team settings to transfer ownership.
  - Sole member (owner) → the team is deleted too.
  - Otherwise the membership goes with the user.
  - Habits, logs, `DigestDelivery` and allauth `EmailAddress` rows cascade.
  - The user is logged out, then redirected to the landing page with a message.

## Scope
In:
- `accounts/forms.py`: `ProfileForm` (`display_name`, 1–60 characters, stripped); `DeleteAccountForm` (`password`, checked with `user.check_password`)
- `accounts/services.py`: `delete_account(user) -> None` (atomic; raises `OwnerMustTransfer`)
- `accounts/views.py`: profile section on `accounts:settings`; `accounts:delete` GET confirm, POST `/account/delete/`
- `accounts/templates/accounts/settings.html` (profile form, links to `account_email` and `account_change_password`, digest preference, a "Delete account" link), `accounts/templates/accounts/delete_confirm.html`
- Tests: `accounts/tests/test_profile.py`, `accounts/tests/test_delete_account.py`

Out: data export (not planned).

## Steps
1. Add `ProfileForm` and the profile section on the settings page, with links to `account_email` and `account_change_password`.
2. Write `delete_account` with the deletion rules in Context. Test it first: member, sole owner, and owner of a team with other members.
3. Add the delete confirm view and template: POST-only deletion with a password check, then logout and a redirect with a message.
4. Write the tests in the Acceptance criteria.

## Acceptance criteria
- [ ] Display name: a valid change is saved and shown in the nav and on the board; a blank value or more than 60 characters shows an error.
- [ ] The settings page links to the `account_email` and `account_change_password` URLs.
- [ ] Deleting with a wrong password shows an error, and the user still exists.
- [ ] A member deleting their account removes the user, their habits, logs and deliveries. The team and the other members are unaffected, and the session is logged out.
- [ ] A sole owner deleting their account also deletes the team.
- [ ] An owner of a team with other members is blocked with a message, and nothing is deleted.
- [ ] Deletion is POST-only. Anonymous users are redirected to login.

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
- If T-016 is already done, add the new routes to its route classification (its test fails otherwise, by design).
- Cut list item 4: may be replaced by admin-side deletion on request, documented on the privacy page.
