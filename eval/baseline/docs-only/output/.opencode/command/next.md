---
description: Pick the next ready TeamHabits task (or the given one) and implement it end to end
---
Implement a task from `docs/plan/tasks/`.

1. **Select.**
   - If `$ARGUMENTS` names a task id, use it.
   - Otherwise read the frontmatter of every `docs/plan/tasks/T-*.md` and choose the lowest-numbered `status: pending` task whose `depends_on` are all `status: done`.
   - If a task is already `in_progress`, resume it instead.
   - If nothing is ready, report the blocked tasks and stop.
2. **Prepare.** Read `AGENTS.md`, the task file, every path and ADR listed in its Context, and the relevant code. Set the frontmatter to `status: in_progress`.
3. **Implement.**
   - Follow the task's Scope and Steps. Delegate slices to the `@backend`, `@frontend`, `@test-engineer` and `@devops` subagents when the task spans layers; you own integration.
   - Stay inside Scope.
   - If blocked (missing network, a human action, or an ambiguous requirement that changes behavior): set `status: blocked`, explain under "Risks and notes", and stop.
4. **Verify.** Run every command in the task's Verification block, then `make check`. Fix failures. Never weaken tests.
5. **Review.** Run the `@reviewer` subagent with the task id. Fix every blocker and major finding and re-run it until the verdict is PASS.
6. **Close.**
   - Append `## Completion notes` to the task file: what changed, deviations, pinned versions, manual check results, follow-ups.
   - Set `status: done`.
   - Commit as `<type>(<scope>): <summary> (T-xxx)`. Do not push.
7. **Report.** Give the task id, the verdict, the files changed and the next ready task(s).
