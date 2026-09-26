<!-- bae:begin -->
@AGENTS.md

# Claude Code specifics
- **Slash commands:**
  - `/next [T-XXX]` implements the next eligible task (or the one named) from start to finish.
  - `/review [T-XXX]` runs the reviewer.
  - `/status` shows plan progress.
- **Subagents:**
  - Delegate a task to the subagent named in its "Suggested agent" line: `backend`, `platform` or `test-engineer`.
  - Always run `reviewer` before setting `status: done`.
- **Todo list:** when working on a task, keep a todo list that mirrors the task's Steps and Acceptance criteria.
- **Python:** always call the interpreter as `.venv/bin/python`. Don't rely on an activated venv.
- **Dev server:** don't start it in the foreground; it blocks the session. Exercise the API through `TestClient` tests or `scripts/smoke.py`.
- **Permissions:** if a command is denied, don't retry it unchanged. Report it and pick an allowed alternative.
<!-- bae:end -->
