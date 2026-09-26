---
description: Pick the next ready task (or the task id given), implement it, verify it, get it reviewed, and mark it done
argument-hint: "[T-XXX]"
---
Implement the next task of the go-service plan. Argument: `$ARGUMENTS` (optional task id).

1. Read `AGENTS.md` and `docs/plan/04-roadmap.md`.
2. If `docs/plan/`, `AGENTS.md`, `CLAUDE.md`, `.claude/` or `.opencode/` are untracked (check `git status --porcelain`), commit them first: `git add AGENTS.md CLAUDE.md docs/plan .claude .opencode`, then `git commit -m "docs(plan): add implementation plan and agent config"`.
3. Choose the task:
   - If `$ARGUMENTS` is a task id, use `docs/plan/tasks/$ARGUMENTS-*.md`. Refuse if any of its `depends_on` tasks is not `done`.
   - Otherwise, if a task has `status: in_progress`, resume it.
   - Otherwise, take the lowest-numbered task with `status: pending` whose `depends_on` tasks are all `done`.
   - If nothing is ready, report each task's status and what blocks it, then stop.
4. Set the task's frontmatter to `status: in_progress`.
5. Read every file in the task's Context. Hand the work to the subagent that owns the files in Scope:
   - `go-backend`: production `.go` files and `docs/api.md`;
   - `go-tests`: `*_test.go`;
   - `tooling-ci`: `scripts/`, `.github/`, `go.mod`, `go.sum`, `.gitignore`.
   Pass each subagent the task file path.
6. Run every command in the task's Verification block from the repo root. All must exit 0. Fix and rerun until they do. Never weaken tests or checks.
7. Ask the `reviewer` subagent to review the task. Fix every FAIL item and review again until PASS.
8. On PASS:
   - set `status: done`;
   - stage only the files changed for this task plus the task file (never `.bae/`);
   - commit with `git commit -m "<type>(<scope>): <task title> (T-XXX)"`;
   - never push.
9. If you are blocked (missing information, an external failure): set `status: blocked`, add the reason under "Risks and notes", and stop.
10. Report: task id, files changed, each verification command with its exit code, the reviewer's verdict, and the next ready task.
