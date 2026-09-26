---
id: T-017
title: Run the accessibility and mobile polish pass on core flows
status: pending
phase: 3
depends_on: [T-015]
size: S
risk: low
---
## Goal
Core flows meet WCAG 2.2 AA basics and work at a 360 px viewport:
- sign-up and log-in
- onboarding and join
- habits
- board
- team and account settings

Specifically: labeled controls, one `h1`, visible focus, non-color status, adequate tap targets, and toggles that are announced to screen readers.

## Context
- Read: `docs/plan/01-prd.md` (non-functional requirements: accessibility, mobile), `docs/qa/manual-checklist.md` (T-008), `habits/templates/habits/_log_cell.html`, `static/css/app.css`.
- Live region: `base.html` gets `<div id="live-status" class="visually-hidden" aria-live="polite"></div>`. The `set_day` HTMX response adds an out-of-band element (`hx-swap-oob="true"`, same id) with text such as "Read: Tue 22 Sep marked done".

## Scope
In:
- Template and CSS fixes across the apps' templates, `templates/`, `static/css/app.css`
- `habits/views.py` and the partial for the out-of-band live region
- `core/tests/test_accessibility.py`: parametrized over the page URLs (anonymous and authenticated as appropriate); parse with BeautifulSoup
- `docs/qa/manual-checklist.md`: add sections for all core flows

Out: a full audit by an external tool, or browser automation (not planned; see risk R-7).

## Steps
1. Write `core/tests/test_accessibility.py` first, then run it to list the failing pages and checks.
2. Fix the templates and CSS: labels, headings, focus styles, tap targets, reduced motion.
3. Add the `#live-status` region to `base.html` and the out-of-band element to the `set_day` HTMX response.
4. Extend `docs/qa/manual-checklist.md` to every core flow, run it at 360×740 and at 200% zoom, and record the results in the Completion notes.

## Acceptance criteria
- [ ] For every tested page:
  - [ ] `<html lang="en">`
  - [ ] exactly one `h1`
  - [ ] headings don't skip levels
  - [ ] every visible `input`, `select` and `textarea` has a `<label for>` or an `aria-label`
  - [ ] every `img` has `alt`
  - [ ] a skip link to `#content` exists
- [ ] Board and habits: every toggle `button` has `aria-pressed` and an `aria-label` naming the habit and date; read-only cells have an `aria-label`; tables have a `caption` and `th` elements with `scope`.
- [ ] An HTMX `set_day` response includes the out-of-band `#live-status` element with the state text.
- [ ] CSS: a `:focus-visible` outline on interactive elements; board cells at least 2.25rem (36 px) square; a `prefers-reduced-motion` rule disables transitions.
- [ ] The manual checklist was run at 360×740 and at 200% zoom for every core flow: no horizontal page scroll, keyboard-only completion of every flow, text contrast of 4.5:1 or more (browser devtools). Results are recorded in the Completion notes.

## Verification
```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run python manage.py check --fail-level WARNING
uv run pytest core/tests/test_accessibility.py -q
uv run pytest --cov
```
Every command exits 0. The manual checklist results appear in the Completion notes.

## Risks and notes
- Cut list item 1: if behind, keep only the manual checklist and blocker fixes.
