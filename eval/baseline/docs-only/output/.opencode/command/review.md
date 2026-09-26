---
description: Read-only review of a TeamHabits task against its acceptance criteria and project rules
agent: reviewer
subtask: true
---
Review the task `$ARGUMENTS`. If no id is given, use the task whose frontmatter is `status: in_progress`; if there is none, use the most recently `done` task.

1. Read `AGENTS.md`, the task file in `docs/plan/tasks/`, the ADRs it cites, and the current `git diff` (or the task's commit if the tree is clean).
2. Check every acceptance criterion with evidence. Run every command in the task's Verification block and report exit codes. Check scope, domain rules, security, quality and docs as defined in your agent instructions.
3. Output: the Verdict (PASS or FAIL), criteria with evidence, verification exit codes, findings (`[blocker|major|minor] path:line — problem — fix`) and out-of-scope changes.

Do not modify files, change task status, or commit.
