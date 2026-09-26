---
description: Review a plan task (default: the in_progress task) against its acceptance criteria and AGENTS.md conventions, without changing anything.
agent: reviewer
subtask: true
---
Target task ID (may be empty): $ARGUMENTS

1. **Choose the task.**
   - If no ID was given, use the task in `docs/plan/tasks/` with `status: in_progress`.
   - If there is none, use the most recent task ID in `git log --oneline`.
2. **Review.** Follow your reviewer procedure for that task. Run its Verification block and the four Check commands from AGENTS.md.
3. **Output.** Return the verdict in your standard output format.
4. **Hands off.** Do not edit files, change task status, or commit.
