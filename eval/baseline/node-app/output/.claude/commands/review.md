---
description: Run the read-only reviewer against a task's acceptance criteria and the current diff
argument-hint: "[T-xxx]"
---
Use the `reviewer` subagent to review task `$ARGUMENTS`, or, if no id is given, the task in `docs/plan/tasks/` with `status: in_progress`.

The reviewer must:
- run the task's Verification block and the full gate from AGENTS.md;
- check each acceptance criterion with evidence (a test name or `file:line`);
- check scope, conventions and security rules;
- return `VERDICT: PASS` or `VERDICT: FAIL` with findings tagged `blocking` or `non-blocking`.

Show the reviewer's report as is. Don't modify any files and don't change task statuses.
