# ADR-008: Hosting on Render with Docker

- Status: Accepted (subject to open question 2)
- Date: 2026-09-26

## Context
One person runs the service on a small budget. It needs managed Postgres with backups, a way to run the hourly job, TLS on a custom domain, and little operations work.

## Decision
- A Render Blueprint (`render.yaml`) defines:
  - `teamhabits-web`: a Docker web service running gunicorn, with whitenoise for static files
  - `teamhabits-digest`: a cron job on the same image
  - `teamhabits-db`: managed PostgreSQL 17
  - `teamhabits-shared`: an env var group; secrets are `sync: false`
- Every deploy runs a pre-deploy step first: `check --deploy --fail-level WARNING`, then `createcachetable`, then `migrate --noinput`. The health check is `/healthz`.
- There is one environment. Before launch it serves as staging on the `onrender.com` hostname. At launch it gets the custom domain (T-018), and staging test accounts are removed through the admin first.
- Sentry's free tier is optional, enabled through `SENTRY_DSN`. A free uptime monitor watches `/healthz`. Logs go to stdout.
- Backups: Render's managed Postgres backups for the chosen plan, plus a weekly manual `pg_dump`. A restore drill happens before launch.
- The cost target is under about US$30/month. Verify current plans and prices before creating services.
- Agents never deploy. The human creates the services, sets the secrets and deploys.

## Consequences
- Upside: a managed database, cron and TLS with no servers to maintain. The Dockerfile keeps a move to another host possible.
- Downside: Render's plan names and blueprint fields change over time, so they are always checked against current docs.

## Alternatives considered
- **Fly.io:** more operations settings to manage.
- **Railway:** usage-based pricing.
- **A VPS with Docker Compose:** cheapest, but backups, TLS and updates become our job.
- **Heroku:** cost.
