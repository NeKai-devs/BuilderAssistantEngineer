# ADR-006: Time zones, the logging window and streaks

- Status: Accepted (subject to open questions 3 and 5)
- Date: 2026-09-26

## Context
"Did I do it today?" depends on where the team is. DST changes and week boundaries are classic sources of bugs. The board, logging and the digest must all agree.

## Decision
- **Time zone:** each team has an IANA time zone, set at creation. The browser's zone is pre-selected, otherwise UTC. It defines "today", the week and the digest hour for everyone in the team.
- **Weeks:** Monday to Sunday (ISO).
- **Binary logs:** a `HabitLog(habit, day)` row means done; no row means not done. There are no skips, counts or targets.
- **Logging window:**
  - members log only their own active habits
  - only for the team-local days `today-6 … today`
  - never before the habit's local creation date

  Endpoints set a state (`done=1|0`), so repeating a request is harmless.
- **Streaks:**
  - A streak is the number of consecutive done days ending on a given day.
  - The current streak ends today if today is done, otherwise yesterday. This grace means an unlogged today doesn't break the streak until the day ends.
  - Past weeks show the streak as of that week's Sunday.
  - The computation looks back at most 366 days, and 366 or more displays as `365+`.
- **Habit visibility in a week:** the habit was created (local date) on or before the week's end, and was not archived before the week's start.
- **Where it lives:** `core/dates.py` and `core/streaks.py`, as pure functions that take `now` or `today` explicitly. `team_today` is the only function that reads the clock.
- **Time zone changes:** changing a team's time zone moves "today" immediately. Stored log dates don't change.

## Consequences
- Upside: one shared board with one week boundary for everyone, and all the logic in one place with 100% test coverage.
- Downside: members far from the team's zone see "today" roll over at odd hours (open question 3).
- The 7-day window lets people catch up without rewriting history.

## Alternatives considered
- **Per-member time zones:** makes "today" on the shared board ambiguous.
- **Storing log timestamps instead of dates:** a timestamp's date shifts whenever the zone changes.
- **Unlimited backfill:** streaks would become meaningless.
