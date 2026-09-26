---
description: Run the read-only reviewer on a task (default is the in_progress task) and report PASS/FAIL with evidence
argument-hint: "[T-XXX]"
---
Review a go-service task without changing any files. Argument: `$ARGUMENTS` (optional task id).

1. Choose the task:
   - if `$ARGUMENTS` is a task id, use `docs/plan/tasks/$ARGUMENTS-*.md`;
   - otherwise use the task with `status: in_progress`;
   - if there is none, use the most recently committed `done` task (`git log -1 --format=%s`).
2. Ask the `reviewer` subagent to review that task file, following its checklist and output format.
3. Show the reviewer's full verdict. Don't change task status or any files; `/next` does that.
