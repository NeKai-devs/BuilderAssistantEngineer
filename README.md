# builder-assistant-engineer

Turn an idea, or an existing repository, into an execution plan that console AI agents can run on their own: Claude Code, opencode, Codex CLI, Gemini CLI or any other.

It acts as your tech lead and architect. It interviews you, analyzes the repository and writes files your agent reads as soon as it opens the repo: project memory (`AGENTS.md`), a phased plan, tasks that are ready-to-run prompts, and specialized subagents. Then it hands tasks to the agent one by one and only marks a task done after a series of [gates](#gates) the agent cannot skip: the task's own checks, no regressions in the project's lint and tests, a handoff note, mechanical checks on the diff and a review.

- Zero friction: `npx builder-assistant-engineer` inside your project. No API key required if you already use an agent CLI.
- Native output for each agent: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.claude/agents`, `.opencode/agent`, slash commands.
- Greenfield and brownfield: proposes a stack for new projects, and inventories stack, architecture, conventions, tests, debt and risks (with file paths as evidence) for existing ones.
- English and Spanish (`--lang en|es`). MIT. No telemetry.

## Quickstart (60 seconds)

```sh
cd your-project
npx builder-assistant-engineer init    # pick backend, agents and language; answer a short interview
npx builder-assistant-engineer plan    # analyze the repo and write the plan, memory and subagents
npx builder-assistant-engineer next    # run the next task, verify it, review it, mark it done
npx builder-assistant-engineer status  # see progress
```

Requires Node.js 20.12 or newer. For `init`, `plan` and `next` you also need one of the [backends](#backends): an agent CLI you already use, an API key, or any AI you can copy and paste into.

## What you get

```text
AGENTS.md                         project memory for every agent: purpose, stack, commands, architecture, rules
CLAUDE.md / GEMINI.md             import AGENTS.md plus tool-specific rules (only for targeted agents)
docs/plan/00-overview.md
docs/plan/01-prd.md
docs/plan/02-architecture.md      brownfield: current state with evidence, target state, migration path
docs/plan/03-decisions/ADR-001-*.md
docs/plan/04-roadmap.md           phases, demo criteria, dependency graph, task index
docs/plan/tasks/T-001-*.md        one self-contained prompt per task
.claude/agents/*.md               subagents in Claude Code's format, including a reviewer
.opencode/agent/*.md              the same subagents in opencode's format
.claude/commands/*.md             next, review and status commands (and .opencode/command/*.md)
```

Every task works as a prompt on its own:

```sh
claude -p "$(cat docs/plan/tasks/T-003-*.md)"
```

A task file looks like this:

````markdown
---
id: T-003
title: Expose GET/POST /users with consistent errors
status: pending
phase: 2
depends_on: [T-001, T-002]
size: M
risk: low
tests: required
---
## Goal
## Context
## Scope
## Steps
## Acceptance criteria
## Verification
```sh
go test ./...
make check
```
Both commands exit 0.
## Risks and notes
## Log
````

The task's state lives in its frontmatter (`pending`, `in_progress`, `done`, `blocked`), so progress is versioned with your code. `tests: required` means the task's diff must touch a test file. `## Log` starts empty; the agent that finishes the task writes its handoff note there.

## Example

```text
$ npx builder-assistant-engineer status

Phase 0  ████████████████████ 1/1
  ✔ T-001  M  medium  Create a reproducible quality gate  1 attempt(s), 14m

Phase 1  ░░░░░░░░░░░░░░░░░░░░ 0/1
  ▶ T-002  S  low     Expose GET /health on a testable Gin router  in_progress  2 attempt(s), 9m

Phase 2  ░░░░░░░░░░░░░░░░░░░░ 0/2
  ○ T-003  M  medium  Implement the in-memory user store  pending
  ○ T-004  M  low     Expose GET/POST /users with consistent errors  pending  waiting on T-002, T-003

1/4 done (25%) · next: T-002 Expose GET /health on a testable Gin router

Metrics from .bae/runs
  attempts: 3 over 2 task(s), 1.5 per task
  done on the first attempt: 1/2 (50%)
  regressions caught: 1
  time per done task: 14m on average, 14m in total
```

`plan` ends with a short summary. If the analyst has questions, blocking ones are asked right there and the rest are listed; every question and answer is saved to `.bae/interview.md`, and after answering a blocking question you can plan again immediately. A clear brief is expected to produce no questions.

## Commands

| Command | What it does |
| --- | --- |
| `init` | Detects greenfield or brownfield, lets you choose the backend, target agents (multi-select) and language, runs the interview and saves `.bae/config.json` and `.bae/interview.md`. `--brief <files>` loads a written brief. |
| `plan` | Builds the repository digest, runs the analyst, checks the paths it cites and writes every artifact. `--only plan\|agents\|memory` writes one group. Shows a diff and asks before writing. |
| `next` | Takes the first task in progress, or the first pending task whose dependencies are done. Hands it to the agent and marks it done only when every [gate](#gates) passes. `--headless` runs the agent without a session. |
| `status` | Phases, tasks, progress and local metrics: attempts per task, tasks done on the first attempt, regressions caught and time per task. |
| `replan` | Re-analyzes the repository with the finished work. Keeps done tasks, updates or removes pending ones, never reuses ids, and prepends an entry to `docs/plan/CHANGELOG.md`. |
| `review [task]` | Runs the mechanical checks and then the generated reviewer, read-only, on a task's diff against its acceptance criteria and `AGENTS.md`. Exits with 1 when the review fails. Defaults to the task in progress. |

Global flags: `--backend <name>`, `--lang en|es`, `--dry-run` (prints exactly what would be sent to the AI and changes nothing) and `-y, --yes` (accepts every confirmation).

## Backends

| Backend | Runs | `plan` and `review` | `next` | Needs |
| --- | --- | --- | --- | --- |
| `claude` | `claude -p` | read-only tools (`Read`, `Grep`, `Glob`) | interactive session; `--headless` uses `--permission-mode acceptEdits` | [Claude Code](https://code.claude.com) |
| `opencode` | `opencode run` | `plan` agent (no edits) | interactive TUI; `--headless` uses the default build agent | [opencode](https://opencode.ai) |
| `codex` | `codex exec` | `--sandbox read-only` | interactive session; `--headless` uses `--sandbox workspace-write` | [Codex CLI](https://github.com/openai/codex) |
| `gemini` | `gemini -p` | `--approval-mode plan` | `gemini -i`; `--headless` uses `--approval-mode auto_edit` | [Gemini CLI](https://github.com/google-gemini/gemini-cli) |
| `api` | HTTPS | single request with the digest | copy-and-paste flow, since an API cannot edit your repo | an API key |
| `manual` | you | prints the prompt, copies it to the clipboard, reads the answer from stdin or `.bae/tmp/response.md` | copy-and-paste flow | any AI, even a web chat |

`init` detects which agent CLIs are installed and suggests the first one. Agent backends receive the prompt on stdin, get the repository digest, and may explore the repository themselves. The analyst never writes files: the CLI parses its answer and writes them. No backend is ever run with permission bypass (`--dangerously-skip-permissions`, `--yolo` and similar).

### API backend

| Variable | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY` | Uses the Anthropic Messages API. The default model is `claude-opus-5`. |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | Any OpenAI-compatible endpoint: OpenAI, OpenRouter, Ollama (`http://localhost:11434/v1`, no key needed) and others. |
| `BAE_MODEL` | Model to use. Required for OpenAI-compatible endpoints. |
| `BAE_API_PROVIDER` | `anthropic` or `openai`, when both sets of variables are present. |
| `ANTHROPIC_BASE_URL` | Optional Anthropic-compatible proxy. |

## How `next` works

1. Picks the task in progress, or the first pending task whose `depends_on` are all done, ordered by phase and id.
2. Marks it `in_progress`, records the current commit so the review sees only this task's changes and, when the regression gate is `full`, runs the project's lint and test commands to record a baseline.
3. Hands it to the agent. The prompt opens with where the plan stands, the project commands and the handoff notes of the last three finished tasks. By default it opens an interactive session with the task as the first prompt; exit the session when you are done. With `--headless` the agent runs on its own with edits accepted.
4. Runs the gates below. Commands are shown before they run (`--yes` skips the question), always in the repository root. Commands such as `sudo`, `rm -rf`, `curl | sh`, `git push`, `git reset --hard` or `npm publish` are refused, even with `--yes`.
5. If every gate passes, the task is marked `done`. Otherwise it stays `in_progress` and you see why.
6. With `--headless`, a failed attempt is retried with the task plus the failure output, up to two retries. After that the task is marked `blocked` and the logs stay in `.bae/runs/T-NNN/`.

## Gates

Each one is a check, not a document: the agent cannot skip it, and a task that fails one is not `done`.

| Gate | When | What it does |
| --- | --- | --- |
| Evidence | `plan`, `replan` | Every path cited in the architecture, the ADRs and each task's Context must exist, and every `path:line` range must fit in the file. Files the plan will create are marked `(new)`. Missing paths trigger one retry that asks the analyst to fix only those; paths that stay unverified are listed under the summary and in `.bae/tmp/plan-report.json`. |
| Questions | `plan`, `replan` | Blocking questions are asked on the spot; the others are listed. All of them are saved to `.bae/interview.md`, and you can plan again right away with your answers. |
| Verification | `next` | The commands in the task's `## Verification` block must exit 0. |
| Regression | `next` | Runs the project's `lint` and `test` commands after the task. A command that passed before the task and fails after it blocks the task; one that already failed is recorded as preexisting and does not. |
| Handoff note | `next` | The task's `## Log` must hold a note of at most 8 lines: what changed, decisions, traps. |
| Mechanical review | `next`, `review` | On the task's diff: a `.env` or key file, or an added credential, fails; `tests: required` fails if no test file changed; files outside the task's Scope are reported. The AI reviewer only runs when nothing here blocks. |
| Review | `next`, `review` | The generated reviewer checks the diff against the acceptance criteria and `AGENTS.md`. |
| Lessons | `next` | When a task ends `blocked` or fails its review twice, the agent proposes the root cause and a one-line rule. Once you approve it (`--yes` approves), the rule goes to a Lessons learned list in the managed block of `AGENTS.md`, which replans keep. |

### Configuration

`plan` fills the project's commands in `.bae/config.json`, first from the analyst and then from `package.json` scripts, Makefile targets, Python tools, `go.mod` or `Cargo.toml`. It never overwrites a command you set.

```json
{
  "commands": {
    "test": "npm test",
    "lint": "npm run lint",
    "typecheck": "npm run typecheck",
    "build": "npm run build"
  },
  "gates": { "regression": "full" }
}
```

`gates.regression` is `full` (default: baseline before the task, lint and test after it), `task` (lint and test only after the task, so any failure blocks; cheaper when the suite is already green) or `off` (only the task's own Verification).

## Customizing prompts

The prompts live in [`src/prompts`](src/prompts). To change one for a project, copy it to `.bae/prompts/<name>.md` and edit it; the CLI uses your copy instead. Every `{{variable}}` must stay defined, or the CLI stops with an error.

| Prompt | Variables |
| --- | --- |
| `analyst.md` | `mode`, `project_type`, `output_language`, `target_agents`, `interview`, `repo_digest`, `can_explore_repo`, `prior_plan` |
| `task.md` | `context`, `task`, `task_path`, `max_log_lines`, `suite` (what `next` hands to the agent) |
| `review.md` | `reviewer`, `agents_md`, `task`, `diff`, `checks`, `output_language` |
| `retry.md` | `task`, `failure`, `attempt` |
| `fix-format.md` | `error`, `format`, `previous_response` |
| `fix-paths.md` | `paths`, `files`, `repo_files` |
| `continue.md` | `prompt`, `partial`, `next_marker` |
| `lesson.md` | `reason`, `task`, `failures`, `agents_md`, `output_language` |

The analyst answers in a strict format (`<<<SUMMARY>>>`, `<<<QUESTIONS>>>`, `<<<CONFIG>>>` and `<<<FILE: path>>>` blocks). Known slips are repaired locally first: markers with extra spaces or in lowercase, and a missing `<<<END FILE>>>` on the last block when the backend reports that the answer ended normally. If the answer is cut off by the model's output limit, the CLI asks it to continue from the unfinished block (up to three times). If the answer is still malformed, the CLI asks once to fix only the format; if it is still wrong, the raw answer is saved to `.bae/tmp/last-response.md`. Repairs, retries and unverified paths are recorded in `.bae/tmp/plan-report.json`.

## Files and safety

- `.bae/config.json` holds configuration only; `.bae/interview.md` holds your answers and the analyst's questions, and can be edited by hand. `.bae/runs/T-NNN/` keeps each task's base commit, regression baseline, run logs, attempt records (`attempts.jsonl`, the source of the `status` metrics) and lesson. `.bae/runs/` and `.bae/tmp/` are added to `.gitignore`.
- The digest respects `.gitignore` and `.baeignore`, skips binaries, lockfiles and `node_modules`, never reads `.env` files or keys, redacts tokens and secrets it finds, and stays within a character budget (100,000 by default, `digest.maxChars` in the config) with priority manifests > entry points > docs > the rest.
- Existing files are merged, not overwritten. Generated memory goes between `<!-- bae:begin -->` and `<!-- bae:end -->` in `AGENTS.md`, `CLAUDE.md` and `GEMINI.md`; your text outside the markers is kept. Plan files are shown as a diff before writing, and done tasks are never touched.
- Nothing is sent anywhere except to the backend you choose. There is no telemetry.

## Global install

```sh
npm install -g builder-assistant-engineer
bae status
```

`bae` is a short alias that only exists after a global install. Do not run `npx bae`: that is a different npm package.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
