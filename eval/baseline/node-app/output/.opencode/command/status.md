---
description: Show plan progress - task statuses, dependencies, next eligible task and blockers (read-only)
---
Read the frontmatter of every `docs/plan/tasks/T-*.md` and print:

1. A table with columns `id | title | phase | status | depends_on | size | risk`, sorted by id.
2. Counts per status, and per phase: done / total.
3. The next eligible task, using the rule in AGENTS.md "How to pick the next task".
4. Each `blocked` task with the reason from its "Risks and notes".
5. Any inconsistency: a `done` task with an unfinished dependency, more than one `in_progress` task, or a dependency on an unknown id.

Don't modify any files.
