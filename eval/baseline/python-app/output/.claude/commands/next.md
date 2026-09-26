---
description: Pick the next eligible plan task (or the given id), implement it, verify it, get a reviewer PASS, mark it done and commit.
argument-hint: "[T-XXX]"
---
Requested task ID (may be empty): $ARGUMENTS

1. **Select the task.**
   - If an ID was given, use `docs/plan/tasks/<id>-*.md`. If its `depends_on` tasks are not all `done`, report that and stop.
   - Otherwise, if a task has `status: in_progress`, resume it.
   - Otherwise, take the lowest-ID task with `status: pending` whose `depends_on` tasks are all `done`.
   - If nothing is eligible, list the remaining tasks and what blocks them, then stop.
2. **Prepare.**
   - If `.venv/` is missing, run the Setup commands from AGENTS.md.
   - Set `status: in_progress` in the task's frontmatter.
3. **Read.** Read the whole task file and every file and ADR listed in its Context section.
4. **Implement.**
   - Delegate to the subagent named in the task's "Suggested agent" line (`backend`, `platform` or `test-engineer`), passing it the task file path. If a change falls outside that agent's write scope, hand it to the owning agent.
   - Stay inside the task's Scope.
5. **Verify.**
   - Run every command in the task's Verification block, then the four Check commands from AGENTS.md.
   - Fix and re-run until all exit 0.
   - Never weaken a test, lint rule, mypy setting or coverage floor to get a green run.
6. **Review.**
   - Invoke the `reviewer` subagent with the task ID.
   - On CHANGES_REQUESTED, fix the findings and repeat steps 5 and 6.
   - After 3 failed rounds, set `status: blocked`, write the reason under "Risks and notes", and stop.
7. **Finish.**
   - Set `status: done`.
   - Stage the changed files, including the task file, and commit `<type>(<scope>): <summary> (<task id>)`, e.g. `feat(notes): add GET /notes listing (T-004)`.
   - Do not push.
8. **Report.**
   - the task ID and title
   - files changed
   - each verification command with its exit code
   - the reviewer verdict
   - the next eligible task
