<!-- bae:begin -->
@AGENTS.md

## Claude Code specifics
- Slash commands: `/next [T-XXX]` implements the next ready task, `/review [T-XXX]` runs the reviewer, `/status` shows the plan state. They live in `.claude/commands/`.
- Subagents in `.claude/agents/`:
  - `go-backend`: production Go code and `docs/api.md`.
  - `go-tests`: `*_test.go` files.
  - `tooling-ci`: `scripts/`, `.github/`, `go.mod`, `go.sum`, `.gitignore`.
  - `reviewer`: read-only; its PASS is required before a task is marked `done`.
- Give a subagent the task file path and nothing vaguer. Subagents also read AGENTS.md.
- Keep this file thin. Rules that apply to every agent tool belong in AGENTS.md.
- Never approve your own work: the `reviewer` subagent decides whether a task is `done`.
<!-- bae:end -->
