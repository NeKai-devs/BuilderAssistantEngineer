# TeamHabits — Product requirements (v1)

Status: draft for v1 · Last updated: 2026-09-26 · Launch target: 2026-11-06
Open questions: `04-roadmap.md` → Open questions. The defaults below apply until they are answered.

## Problem
Small groups want to keep each other accountable for daily habits. Examples: a startup crew, a study group, a running club. Personal habit apps are solitary, and chat threads lose track. TeamHabits gives each team one shared weekly board and a Monday email that celebrates streaks.

## Users
- **Member**: logs their own habits and sees the team's week.
- **Owner**: the member who created the team. Also manages the team (settings, invite link, removals).
- **Visitor**: reads the landing, privacy and terms pages, and can sign up.

Assumptions:
- teams of 2–20 people
- English UI
- mostly used on phones
- up to about 50 teams in the first months

## Goals
- **First deliverable** (Phase 1, by 2026-10-11): on staging, users can sign up, create habits, log them and see the weekly board.
- **Launch** (2026-11-06): the Monday digest, team and account self-service, and a hardened production setup, run by one person.
- **Budget**: hosting under about US$30/month (verify current pricing), with free tiers for errors and uptime monitoring where possible.

## Success measures (first 4 weeks after launch)
- Every eligible member gets exactly one digest per week. Zero duplicates, and failures are retried and visible in the admin.
- Zero incidents of one team seeing another team's data.
- The board renders in under 500 ms of server time at p95 for a 20-member team.
- At least 5 active teams, meaning at least one log per member per week. This is a signal, not a gate.

## Scope
In:
- email and password accounts, with display names
- one team per user, invite links, and a team time zone
- binary daily habits
- day logging for the last 7 days
- the weekly board with streaks and navigation to past weeks
- the Monday digest email
- preferences and unsubscribe
- team administration
- account deletion
- privacy and terms pages

Out:
- native apps and payments (per the brief)
- social login and 2FA (deferred)
- several teams per user
- private habits
- habit targets, counts or skip days
- reminders or push notifications
- charts and analytics
- data export
- languages other than English

## User stories
| ID | Story | Tasks |
|---|---|---|
| US-1 | As a visitor, I sign up with my email, a password and a display name. | T-003 |
| US-2 | As a user, I log in, log out and reset a forgotten password. | T-003 |
| US-3 | As a signed-in user without a team, I create a team with a name and time zone and become its owner. | T-004 |
| US-4 | As a signed-in user, I join a team through its invite link, which also works right after sign-up. | T-004 |
| US-5 | As a member, I create, rename and archive my own habits. | T-005 |
| US-6 | As a member, I see my team's week on one board (members, habits, done days, streaks), mark my own habits done for recent days right from it, and browse past weeks. | T-007, T-008 |
| US-7 | As a member, I get a Monday email with last week's summary for my team, my own section first. | T-011, T-012 |
| US-8 | As a member, I turn the Monday email off in settings or with one click from the email. | T-013 |
| US-9 | As a user, I verify my email address so the Monday email reaches me. | T-010 |
| US-10 | As an owner, I rename the team, change its time zone, rotate the invite link, remove members and hand over ownership. As a member, I can leave. | T-014 |
| US-11 | As a user, I change my display name, email and password, and delete my account. | T-015 |
| US-12 | As a visitor, I can read how my data is handled (privacy, terms) before signing up, and the service is run with backups and monitoring. | T-018 |

## Functional requirements
- **FR-1 Accounts.**
  - Sign-up uses email, password (at least 10 characters, Django validators) and display name (1–60 characters).
  - Emails are unique regardless of case.
  - Password reset works by email.
  - Email verification is optional but required to receive digests.
- **FR-2 Teams.**
  - A user belongs to at most one team, and each team has exactly one owner.
  - A team has a name (1–60 characters) and an IANA time zone.
  - Anyone signed in who has the secret invite link can join, up to 20 members.
- **FR-3 Habits.**
  - A habit is a name (1–60 characters) owned by one member in one team.
  - A member can have at most 10 active habits.
  - Archived habits are read-only and remain in the history of past weeks.
- **FR-4 Logging.**
  - A day is either done or not done.
  - Only the habit's owner can set it.
  - Only days in the team-local window `today-6 … today` can be set, and never a day before the habit was created.
  - Setting a day is idempotent.
- **FR-5 Weekly board.**
  - The board shows a Monday–Sunday week, in team-local dates.
  - It lists every current member, viewer first.
  - Each habit that was visible that week shows its done marks and streak.
  - Navigation: previous weeks, and back to this week.
  - The number of queries per request is constant.
- **FR-6 Digest sending.**
  - Each team's digest goes out on Monday from 08:00 team-local time, at most once per member per week.
  - Recipients are members with a verified primary email who haven't opted out.
  - Failed sends are retried up to 3 times.
- **FR-7 Preferences and unsubscribe.**
  - A settings toggle turns the digest on or off.
  - Every digest has a signed unsubscribe link and RFC 8058 one-click headers.
  - A GET request on the link never changes anything.
- **FR-8 Digest content.**
  - Per member: done out of possible days for each habit, and the streak at week end.
  - Highlights: the top 3 streaks of 3 days or more, and the team's total check-ins.
  - A link to that week's board.
  - Members can preview the email in the browser.
- **FR-9 Operations.**
  - `/healthz`
  - the admin at a non-default URL
  - a pre-deploy configuration check
  - `check_launch`
  - runbooks for deploy, email, digest, launch, backup and restore, and incidents

## Non-functional requirements
- **Mobile.** Every core flow works at a 360 px viewport with no horizontal page scroll. Board tap targets are at least 36 px.
- **Accessibility.** WCAG 2.2 AA basics:
  - labeled controls and one `h1` per page
  - visible focus
  - status not shown by color alone
  - text contrast of 4.5:1 or more
  - screen readers announce toggles
  - every flow can be completed with the keyboard alone
- **Performance.** At most 8 queries per board request, whatever the team size. Server time under 500 ms at p95.
- **Security.**
  - HTTPS with HSTS; secure cookies
  - a strict CSP (`'self'`), CSRF on every mutation
  - rate-limited authentication
  - every data access scoped to the user's team (404 across teams)
  - secrets only in environment variables
  - a dependency audit in CI
- **Privacy.**
  - Stored data: email, display name, team, habits, logs and digest delivery records.
  - No analytics or tracking, and no third-party assets.
  - Users can delete their account themselves.
  - Processors: Render, Resend, and Sentry if enabled.
- **Reliability.** Digest sending is idempotent and safe to run concurrently. Backups are restorable, and a restore drill is done before launch.
- **Maintainability.**
  - 85% test coverage, with 100% on the date and streak logic
  - typed code and one settings module
  - runbooks a single person can follow
- **Cost.** Hosting under about US$30/month, with no paid services beyond hosting at launch.
