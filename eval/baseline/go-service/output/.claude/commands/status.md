---
description: Show plan progress - every task's status, what's ready, what's blocked, and the next task to run
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git log:*)
---
Report the state of the go-service plan without changing anything.

1. Read the frontmatter (`id`, `title`, `status`, `phase`, `depends_on`) of every `docs/plan/tasks/T-*.md`.
2. Print a table with columns ID | Title | Phase | Status | Depends on | Ready. A task is ready if it is `pending` and all its `depends_on` tasks are `done`.
3. List `blocked` tasks with the reason from their "Risks and notes".
4. Print the next task `/next` would pick (the `in_progress` task first, otherwise the lowest-numbered ready one), and per phase, how many tasks are done out of the total.
5. Print `git status --porcelain` in one short line, and the last 3 commits (`git log --oneline -3`).
