# TeamHabits — Roadmap

Plan date: 2026-09-26 (Saturday) · Launch: Friday 2026-11-06 · Six weeks, one developer with AI agents.

## Phases
| Phase | Weeks | Tasks | Outcome |
|---|---|---|---|
| 1 — First deliverable | 1–2 (2026-09-28 → 2026-10-11) | T-001 to T-009 | Sign up, create a team, create habits, log them, see the weekly board, running on staging |
| 2 — Monday digest | 3–4 (2026-10-12 → 2026-10-25) | T-010 to T-013 | Transactional email, the digest summary, idempotent Monday sending, unsubscribe |
| 3 — Launch | 5–6 (2026-10-26 → 2026-11-06) | T-014 to T-018 | Team and account self-service, security hardening, accessibility, launch readiness |

Dependency chain: T-001 → (T-002, T-003, T-006, T-009) · T-003 → T-004 → T-005 → T-007 (+T-006) → T-008 → T-011 (+T-010) → T-012 → T-013 · T-008 → T-014 · (T-013, T-014) → T-015, T-016 · T-015 → T-017 · (T-015, T-016) → T-018.

## Timeline
| Week | Dates | Tasks | Human actions |
|---|---|---|---|
| 1 | Mon 2026-09-28 – Sun 10-04 | T-001, T-002, T-003, T-006, T-004 | Answer open questions 1–5. Create the GitHub repo and push. Choose or register the domain. Create a Resend account and add the DNS records (they can take days). Approve the hosting budget. |
| 2 | Mon 10-05 – Sun 10-11 | T-005, T-007, T-008, T-009 | Create the Render services from the blueprint, set the secrets, deploy staging, confirm `/healthz` returns 200. Run the Phase 1 demo on staging. |
| 3 | Mon 10-12 – Sun 10-18 | T-010, T-011 | Confirm the Resend domain is verified. Set `RESEND_API_KEY`, `DEFAULT_FROM_EMAIL` and `SITE_URL` on Render. Send a test email. |
| 4 | Mon 10-19 – Sun 10-25 | T-012, T-013 | Deploy to staging. Set up a test team with 2–3 real inboxes, all verified. |
| 5 | Mon 10-26 – Sun 11-01 | T-014, T-015, T-016 | **Mon 10-26:** confirm the staging digest cron run (Render logs and admin), then test one-click unsubscribe from a real inbox. Run the Phase 2 demo. |
| 6 | Mon 11-02 – Fri 11-06 | T-017, T-018 | Custom domain, HTTPS check, HSTS raise, uptime monitor, restore drill, legal text approval, removal of staging test accounts. **Launch on Fri 11-06.** |
| After | Mon 2026-11-09 | — | Watch the first production digest, following the watch plan in `docs/runbooks/launch.md`. |

## Demo criteria
- **Phase 1** (end of week 2), on staging, with two people using phones:
  - A signs up, creates a team and shares the invite link. B joins through it.
  - Both create habits and log today and earlier days, and each sees the other on the board.
  - Navigating to past weeks works.
  - `make check` and CI are green.
- **Phase 2** (Mon 2026-10-26):
  - Staging sends each verified member of the test team exactly one digest, at or after 08:00 team-local time.
  - Re-running the command sends nothing.
  - Unsubscribing works from both the email header and the footer link.
- **Phase 3** (Fri 2026-11-06):
  - Production runs on the custom domain and `check_launch` passes.
  - The security and accessibility tests are green.
  - The restore drill is recorded and the runbooks are complete.

## Cut list
If the schedule slips, cut in this order, and record the cut in the affected task's Completion notes:
1. T-017: keep only the manual checklist and fixes for blocking issues.
2. T-014: drop team settings editing and ownership transfer. Keep invite rotation, removal and leaving.
3. T-011: drop the digest preview page. Keep the summary and the renderer.
4. T-015: replace self-service deletion with admin-side deletion on request, and say so on the privacy page.

Never cut: team isolation, digest idempotency, T-016 security hardening, backups and the restore drill.

## Risks
| ID | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | Schedule overrun: six weeks, one developer | Medium / high | Phases that each demo on their own, the cut list, and small tasks with explicit Out scope |
| R-2 | Time zone, DST or week-boundary bugs in logging, streaks and digest timing | Medium / high | One date module and one streak module at 100% coverage, explicit `now` everywhere, DST tests (T-006) |
| R-3 | Duplicate or missing digest emails | Medium / high | Claim before send, a unique constraint, a test for every rule, and the digest runbook (T-012) |
| R-4 | Email deliverability: slow domain verification, spam folders | Medium / high | Start DNS in week 1; SPF, DKIM and DMARC; RFC 8058 headers; plain content with no tracking (T-010, T-013) |
| R-5 | One team sees another team's data | Low / critical | `request.team` scoping, the 404 policy, the route classification test (T-016), the reviewer's grep checks |
| R-6 | Agent drift: scope creep, weakened tests, conventions ignored | Medium / medium | Task files with Scope and Out, the reviewer must PASS, the rule to never weaken tests, AGENTS.md |
| R-7 | Accessibility and mobile regressions go unnoticed because there is no browser automation | Medium / medium | HTML assertion tests (T-017), the manual checklist at 360×740 and 200% zoom (T-008, T-017) |
| R-8 | Render plans, prices or blueprint fields differ from what the plan assumes | Medium / low | Check against current docs and cite the URLs; the cost check in the runbook; a portable Docker image |
| R-9 | Behaviour differs between SQLite and PostgreSQL | Low / medium | The CI Postgres job (T-002); only portable ORM features (ADR-003) |

## Open questions
The defaults apply until the owner answers. Tasks refer to these by number.
1. **Product name and sending domain.** Default: working name TeamHabits. The domain is needed by 2026-10-05 for Resend DNS.
2. **Hosting.** Default: Render, under about US$30/month (ADR-008). The alternatives are Fly.io, Railway, or a VPS.
3. **Time zone per team or per member.** Default: one per team (ADR-006). `core/dates.py` takes the zone as an argument, so a change only affects call sites.
4. **One team per user.** Default: yes (ADR-005).
5. **Binary daily habits only.** Default: yes, with no targets, counts or skip days (ADR-006).
