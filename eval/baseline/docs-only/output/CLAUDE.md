<!-- bae:begin -->
# CLAUDE.md

@AGENTS.md

## Claude Code specifics
- Subagents live in `.claude/agents/`: `backend`, `frontend`, `test-engineer`, `devops` and `reviewer`. Delegate each layer of a task to the matching subagent and keep the integration work yourself. The reviewer is read-only and must return PASS before a task is closed.
- Slash commands:
  - `/next [T-NNN]` implements the next ready task end to end
  - `/review [T-NNN]` runs a read-only review
  - `/status` shows plan progress and the human actions that are due
- Keep the todo list in step with the current task's Steps.
- Pushing, deploying, creating external accounts, DNS and secrets are human actions. Write the runbook steps and stop.
<!-- bae:end -->
