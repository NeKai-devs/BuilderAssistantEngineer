---
description: Run the read-only reviewer against a task's acceptance criteria and the current diff
agent: reviewer
subtask: true
---
Review task `$ARGUMENTS`, or, if no id is given, the task in `docs/plan/tasks/` with `status: in_progress`.

- Run the task's Verification block and the full gate from AGENTS.md.
- Check each acceptance criterion with evidence (a test name or `file:line`).
- Check scope, conventions and security rules as defined in your agent instructions.
- Return `VERDICT: PASS` or `VERDICT: FAIL` with findings tagged `blocking` or `non-blocking`.

Don't modify any files and don't change task statuses.
