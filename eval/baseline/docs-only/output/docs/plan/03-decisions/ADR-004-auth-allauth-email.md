# ADR-004: Authentication with django-allauth and email login

- Status: Accepted
- Date: 2026-09-26

## Context
Users sign up with an email address. The Monday digest needs addresses that are known to work, and there's no time to build authentication flows by hand.

## Decision
- A custom `accounts.User`: email is the login field (unique regardless of case), with a `display_name` of up to 60 characters and no username. It is part of the first project migration.
- django-allauth provides sign-up, login, logout (POST only), password reset and email management. Its pages render inside `base.html` through a layout override.
- Email verification is `none` until transactional email works (T-003), then `optional` with a banner (T-010).
- Digests go only to the verified primary address.
- Rate limits use allauth's own limits. In production they are backed by the shared database cache (T-016).
- Sessions last 30 days.
- Social login and 2FA are deferred. Revisit after launch.

## Consequences
- Upside: tested flows for password reset and email changes, with little code.
- Downside: allauth setting names change between versions. Always confirm them against the installed version; `manage.py check --fail-level WARNING` flags deprecated ones.

## Alternatives considered
- **Django's built-in auth views:** more code for sign-up and verification.
- **Magic links only:** every login depends on email delivery.
- **A hosted auth service:** cost, plus personal data going to another processor.
