# ADR-001: Django monolith with server-rendered HTML and htmx

- Status: Accepted
- Date: 2026-09-26

## Context
One developer working with AI agents has six weeks and a small budget to ship a mobile-friendly web app. The interactions are simple: forms, a grid of toggles, and navigating between weeks. Native apps are out of scope.

## Decision
- Build a single Django 5.2 LTS project on Python 3.12, with the apps `core`, `accounts`, `teams`, `habits` and `digest`.
- Render templates on the server. Use htmx 2 for in-place updates (the log cells). Styling is Pico.css 2 plus a small `static/css/app.css`.
- Vendor static assets in `static/vendor/` (pinned by SHA-256). No Node toolchain and no build step.
- Use progressive enhancement: every flow works without JavaScript through form POSTs and redirects.

## Consequences
- Upsides:
  - one deployable and one language
  - fast iteration for agents
  - the Django admin covers operations
  - mature testing tools
- Downsides:
  - less rich client-side interaction, which is acceptable for this product
  - htmx needs care under a strict CSP: no `hx-on`, and indicator styles turned off

## Alternatives considered
- **SPA (React or Next.js) with an API:** two codebases, a build toolchain, and a larger security surface.
- **Rails or Laravel:** equivalent in capability; Django was chosen for its admin and because agents know it well.
- **No-code tools:** can't enforce team isolation or the digest rules.
