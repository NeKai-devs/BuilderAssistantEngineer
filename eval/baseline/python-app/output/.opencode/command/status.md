---
description: Show plan progress: every task with status and dependencies, per-phase completion and the next eligible task.
---
Read the YAML frontmatter of every file in `docs/plan/tasks/`. Do not modify any file.

Output:
1. A table with columns: id | title | phase | status | depends_on | eligible. A task is eligible if it is `pending` and all its dependencies are `done`.
2. Counts per status. For each phase, show `done/total`; a phase is complete when all its tasks are done. Phase demo criteria are in `docs/plan/04-roadmap.md`.
3. The next task:
   - Any `in_progress` task comes first.
   - Otherwise, the lowest-ID eligible task.
4. Blocked tasks, with the reason quoted from their "Risks and notes" section.
5. Open questions still listed in `docs/plan/01-prd.md` under "Open questions".
