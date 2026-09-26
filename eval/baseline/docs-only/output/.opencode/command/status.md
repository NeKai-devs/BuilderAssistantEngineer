---
description: Show TeamHabits plan progress, ready tasks and blockers
---
Report plan progress. Do not modify any file.

1. **Read.** Read the frontmatter (`id`, `title`, `status`, `phase`, `depends_on`, `size`, `risk`) of every `docs/plan/tasks/T-*.md`.
2. **Table.** Print one row per task, grouped by phase: `ID | Title | Status | Depends on | Ready?`. A task is ready when it is `pending` and all its `depends_on` are `done`.
3. **Summary:**
   - done / total for each phase
   - tasks `in_progress`
   - tasks `blocked`, with the reason from their "Risks and notes"
   - the ready tasks, lowest id first (what `/next` would pick)
4. **Git.** Show `git status --short` and `git log --oneline -5`.
5. **Human actions.** Compare against `docs/plan/04-roadmap.md` (the timeline and the current phase's demo criterion) and list which human actions are due now.
