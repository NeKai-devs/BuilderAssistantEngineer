# ADR-007: Weekly digest — hourly cron, claim before send, Resend

- Status: Accepted
- Date: 2026-09-26

## Context
The Monday email is the product's heartbeat. Duplicate or silently missing emails would damage trust. The budget rules out running workers and brokers.

## Decision
- **Content:**
  - Covers the last completed week (Monday to Sunday) for the recipient's team.
  - Personalized: the recipient's own section comes first, followed by every current member. Each habit shows done out of possible days and the streak at week end.
  - Highlights: the top 3 streaks of at least 3 days, and the team's total check-ins.
  - A link to that week's board.
  - Plain text plus simple HTML. No images, no tracking pixels, no link tracking.
- **Timing:**
  - A team is due on Monday once its local hour is at least `DIGEST_SEND_HOUR` (8).
  - A Render cron job runs `send_weekly_digests` every hour at minute 5. Extra runs, and runs that overlap, are harmless.
  - A team gets no digest if every run misses its Monday. The runbook explains how to re-run manually with `--now`.
- **Recipients:** current members with `weekly_digest_enabled`, sent to their verified primary email.
- **No duplicates:**
  - `DigestDelivery(user, week_start)` is unique.
  - Inside a transaction, claim the row by inserting it as `sending`, before anything is sent.
  - Send outside the transaction, then mark the row `sent`, or `failed` with `last_error`.
  - `failed` rows are retried through a conditional update, up to `DIGEST_MAX_ATTEMPTS` (3).
  - `sending` rows are never retried automatically: a missing email is better than a duplicate. The runbook describes how to resolve them.
- **Opt-out:** a settings toggle, a signed unsubscribe link, and RFC 8058 one-click headers (T-013).
- **Transport:**
  - Production sends through Resend via django-anymail; development uses the console backend and tests use locmem.
  - A deploy check rejects fake backends in production.
  - Absolute links are built from `SITE_URL`.
- **No task queue:** the volume is tiny (under about 1,000 emails a week), so sending sequentially within one cron run is enough.

## Consequences
- Upside: one command, one table, and every rule testable with an explicit `now`.
- Downside: a crash during a send leaves a `sending` row that needs manual handling (see `docs/runbooks/digest.md`).

## Alternatives considered
- **Celery beat with Redis:** cost and operations work.
- **One fixed UTC send time:** the wrong local hour for most teams.
- **Amazon SES:** cheaper at scale, but more setup.
- **Postmark:** a similar fit to Resend. Resend was chosen for its free tier and simple DNS setup; verify current terms.
