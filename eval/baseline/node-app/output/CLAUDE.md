<!-- bae:begin -->
@AGENTS.md

## Claude Code specifics
- Subagents in `.claude/agents/`: `toolchain`, `backend`, `test-engineer`, `docs-writer`, `reviewer`. Each task's Context names its owner agent. Delegate to it.
- Slash commands: `/next [T-xxx]` implements the next eligible (or named) task, `/review [T-xxx]` runs the reviewer, `/status` shows task progress (read-only).
- `npm start` blocks. If you need a live server, run it with `run_in_background` and stop it afterwards. Prefer supertest tests or `npm run smoke`.
- Invoke the `reviewer` subagent before setting a task to `done`.
- Ask before running `npm install <pkg>` for any package the task file doesn't name.
<!-- bae:end -->
