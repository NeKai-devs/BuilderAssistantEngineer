---
id: T-012
title: Implement the idempotent send_weekly_digests command and schedule it
status: pending
phase: 2
depends_on: [T-011]
size: M
risk: high
---
## Goal
`python manage.py send_weekly_digests` sends each eligible member their digest once per week:
- on Monday from 08:00 team-local time
- safe to run every hour and concurrently
- tolerant of individual send failures

It is scheduled as an hourly Render cron job. This task delivers the "no duplicate emails" guarantee.

## Context
- Read: ADR-007 (all rules), `digest/summary.py`, `digest/emails.py`, `core/email.py`, `core/dates.py`, `render.yaml`, `docs/plan/01-prd.md` (FR-6).
- Eligibility: a current member of the team, `weekly_digest_enabled=True`, and an allauth `EmailAddress` that is primary and verified. Send to that address.
- A team is due when its local time is Monday with `hour >= settings.DIGEST_SEND_HOUR` (8). `week_start` is the local date minus 7 days.
- Gotchas:
  - Claim before sending, and claim inside `transaction.atomic()` using the unique constraint.
  - Retry `failed` rows with a conditional update (`filter(pk=..., status="failed", attempts__lt=MAX).update(status="sending", attempts=F("attempts") + 1)`) and act only if exactly one row changed.
  - Never retry `sending` rows.
  - Send outside the claim transaction.

## Scope
In:
- `accounts/models.py`: `weekly_digest_enabled = BooleanField(default=True)` plus migration (`--name weekly_digest_enabled`)
- `digest/models.py`: `DigestDelivery(user FK CASCADE, team FK CASCADE, week_start DateField, status CharField choices sending/sent/failed, attempts PositiveSmallIntegerField default 1, last_error TextField blank, created_at, updated_at)` with `UniqueConstraint(fields=["user", "week_start"], name="digest_delivery_one_per_user_week")`; migration; admin with a list filter on status and week
- `digest/sending.py`: `SendReport(teams_due, sent, skipped, failed)` and `send_due_digests(now: datetime, *, dry_run: bool = False, team_id: int | None = None) -> SendReport`
  - failures are logged with `logger.exception` and `last_error` truncated to 500 characters
  - one INFO summary line per run
- `digest/management/commands/send_weekly_digests.py`: options `--now` (ISO 8601 with offset; naive → `CommandError`), `--dry-run`, `--team`
  - prints `teams_due=N sent=N skipped=N failed=N`
  - raises `CommandError` (exit 1) after processing when `failed > 0`
- `config/settings.py`: `DIGEST_SEND_HOUR = 8`, `DIGEST_MAX_ATTEMPTS = 3`
- `render.yaml`: cron service `teamhabits-digest` (runtime docker, `schedule: "5 * * * *"`, `dockerCommand: python manage.py send_weekly_digests`, env from `teamhabits-shared`, `DATABASE_URL` from the database)
- `docs/runbooks/digest.md`: how it works, checking the results in the admin, a manual re-run for a team (`--team <id> --now <Monday 09:00 local ISO>`), resending a stuck `sending` row (delete the row in the admin, then re-run), what happens after a missed Monday
- Tests: `digest/tests/test_sending.py`, `digest/tests/test_command.py`

Out: unsubscribe headers and link (T-013); a settings UI for the preference (T-013).

## Steps
1. Model fields and migrations.
2. `send_due_digests`, with a summary built once per due team and rendered per recipient.
3. The command, wrapping the service.
4. `render.yaml` cron job and runbook.
5. Tests. Pass `now` explicitly; patch `core.email.send_templated_email` to fail for one address where needed.

## Acceptance criteria
- [ ] Nothing is sent on Sunday, on Monday at 07:59 team-local time, or on Tuesday. Emails go out on Monday at 08:00 local time.
- [ ] At one UTC instant, of two teams in `Asia/Tokyo` and `America/Los_Angeles`, only the team whose local time is Monday 08:00 or later sends.
- [ ] Running twice in the same hour: the second run sends 0 and `mail.outbox` doesn't grow.
- [ ] Excluded recipients: members with `weekly_digest_enabled=False`, members whose email isn't verified, and members of other teams.
- [ ] One failing recipient:
  - [ ] the others are still sent
  - [ ] that recipient's row is `failed` with `attempts=1` and `last_error` set
  - [ ] the next run retries and sends it (`attempts=2`, `sent`)
  - [ ] after 3 failed attempts there are no more retries
- [ ] An existing `sending` row causes a skip, with no email.
- [ ] `--dry-run` writes no rows and sends no email, but reports the counts.
- [ ] `call_command("send_weekly_digests", "--now", "2026-09-28T09:00:00+02:00")` prints the summary line. With a forced failure it raises `CommandError`. A naive `--now` raises `CommandError`.
- [ ] The sent email's subject and body come from `render_weekly_digest`, and it's addressed to the verified primary address.
- [ ] `render.yaml` defines the hourly cron job with no secrets inline. `docs/runbooks/digest.md` exists.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run python manage.py makemigrations --check --dry-run
uv run pytest digest -q
uv run pytest --cov
uv run python manage.py migrate --noinput
uv run python manage.py send_weekly_digests --dry-run --now 2026-09-28T09:00:00+00:00
test -f docs/runbooks/digest.md
```
Every command exits 0. The dry run prints a `teams_due=… sent=0 …` line.

## Risks and notes
- High risk: duplicates or silent drops hurt trust. Every rule has a test.
- Human action: after deploying to staging, confirm the cron run on Mon 2026-10-26 in the Render logs and the admin.
