---
description: Read-only review of a TeamHabits task against its acceptance criteria and project rules
argument-hint: "[task id; defaults to the in_progress task]"
---
Review a task without editing anything.

1. **Target.** Use `$ARGUMENTS` if given. Otherwise use the task whose frontmatter is `status: in_progress`; if there is none, use the most recently `done` task.
2. **Review.** Invoke the `reviewer` subagent with that task id and the current `git diff` (or the task's commit if the tree is clean).
3. **Relay.** Return the reviewer's output unchanged (Verdict, criteria with evidence, verification exit codes, findings, out-of-scope changes). Add one line on what to do next: fix the listed findings, or run `/next` to close the task.

Do not modify files, change task status, or commit.
