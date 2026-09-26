---
description: Pick the next eligible task from docs/plan/tasks (or the one given) and implement it end to end
---
Work on the next task of the node-app plan.

1. Read `AGENTS.md`.
2. Pick the task:
   - If `$ARGUMENTS` names a task id, use `docs/plan/tasks/$ARGUMENTS-*.md`, and stop if any of its `depends_on` tasks is not `done`.
   - Otherwise follow "How to pick the next task" in AGENTS.md: resume the `in_progress` task, or take the lowest-id `pending` task whose dependencies are all `done`.
   - If nothing is eligible, report why and stop.
3. Read the whole task file and every ADR and path listed in its Context. Set `status: in_progress` in its frontmatter.
4. Delegate to the owner subagent named in the task's Context (`@toolchain`, `@backend`, `@test-engineer`, `@docs-writer`), or do the work yourself following that agent's rules. Stay inside the task's Scope.
5. Run every command in the task's Verification block, then the full gate. Fix failures until all commands exit 0.
6. Invoke `@reviewer` on the task. Resolve all `blocking` findings and re-run verification.
7. Set `status: done`. If you can't finish, set `status: blocked` and explain why under "Risks and notes".
8. Report: task id, files changed, verification results, reviewer verdict, and the next eligible task.

Don't commit or push unless the user asks.
