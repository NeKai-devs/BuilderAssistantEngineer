---
description: Run the reviewer subagent on a plan task (default: the in_progress task) and report its verdict without changing anything.
argument-hint: "[T-XXX]"
---
Target task ID (may be empty): $ARGUMENTS

1. **Choose the task.**
   - If no ID was given, use the task in `docs/plan/tasks/` with `status: in_progress`.
   - If there is none, use the most recent task ID in `git log --oneline`.
2. **Review.** Invoke the `reviewer` subagent with that task ID.
3. **Relay.** Pass on the reviewer's verdict, acceptance-criteria checklist, verification exit codes and findings, unchanged.
4. **Hands off.** Do not edit files, change task status, or commit.
