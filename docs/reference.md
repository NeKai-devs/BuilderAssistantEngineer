# Reference

The technical reference for bae (npm package `builder-assistant-engineer`). The [README](../README.md) has the quickstart, the [user manual](manual/es/manual.md) explains how to use bae (in Spanish, also as a [PDF](manual/bae-manual-es.pdf)), and [limits.md](limits.md) lists what the gates leave open.

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
.opencode/agent/*.md              the same subagents in opencode's format, converted by bae
.claude/commands/*.md             next, review and status commands from bae's templates (and .opencode/command/*.md); /next sends you to bae next and never marks a task done
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
type: feat
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

The task's state lives in its frontmatter (`pending`, `in_progress`, `done`, `blocked`), so progress is versioned with your code. `tests: required` means the task must run more tests than before or add assertions to a test file. `tests: fix` marks a task whose goal is to repair failing tests: the project's test command must end green. `## Log` starts empty; the agent that finishes the task writes its handoff note there.

## Example

```text
$ npx builder-assistant-engineer status

Branch bae/2026-09-28-1015, created from main
  4f2c9a1 chore: create a reproducible quality gate (T-001)

Phase 0  ████████████████████ 1/1
  ✔ T-001  M  medium  Create a reproducible quality gate  1 attempt(s), 14m

Phase 1  ░░░░░░░░░░░░░░░░░░░░ 0/1
  ▶ T-002  S  low     Expose GET /health on a testable Gin router  in_progress  2 attempt(s), 9m

Phase 2  ░░░░░░░░░░░░░░░░░░░░ 0/2
  ○ T-003  M  medium  Implement the in-memory user store  pending
  ○ T-004  M  low     Expose GET/POST /users with consistent errors  pending  waiting on T-002, T-003

1/4 done (25%) · next: T-002 Expose GET /health on a testable Gin router

Local metrics
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
| `plan` | Builds the repository digest, runs the analyst, checks the paths it cites and writes every artifact. `--only plan\|agents\|memory` writes one group. Shows a diff and asks before writing. At the end it offers to commit what it wrote, with `.bae/config.json` and `.bae/interview.md`, as `chore(bae): plan` (`--yes` commits without asking; `--no-verify` skips the pre-commit and commit-msg hooks). |
| `next` | Takes the first task in progress, or the first pending task whose dependencies are done. Hands it to the agent and marks it done only when every [gate](#gates) passes, then commits it on the run's `bae/` branch. `--new-run` starts a new branch from the current one. `--no-verify` commits without the pre-commit and commit-msg hooks. `--headless` runs the agent without a session. `--allow-skip` goes on when a check cannot run and records the skip. `--allow-dirty` starts a task although tracked files outside the plan have uncommitted changes; without it, an unattended run stops and an interactive one asks. `--accept-finding <id>` accepts one finding by its id (repeatable). |
| `status` | The run's branch and its commits, then phases, tasks, progress and local metrics: attempts per task, tasks done on the first attempt, regressions caught, time per task and the AI cost the attempts reported. |
| `replan` | Re-analyzes the repository with the finished work. Keeps done tasks, updates or removes pending ones, never reuses ids, and prepends an entry to `docs/plan/CHANGELOG.md`. During a run it must be on the run's branch, and commits the new plan there as `chore(bae): replan` (`--no-verify` skips the hooks). |
| `review [task]` | Runs the mechanical checks and then the generated reviewer, read-only, on a task's diff against its acceptance criteria and `AGENTS.md`. Exits with 1 when the review fails. Defaults to the task in progress. Takes `--accept-finding <id>` too. |

Global flags: `--backend <name>`, `--lang en|es`, `--dry-run` (prints exactly what would be sent to the AI and changes nothing) and `-y, --yes` (accepts every confirmation).

Every command that calls the AI ends with the time it took and what the AI cost, as the backend reports it (claude reports it for `claude -p` calls; an interactive session and some backends do not, and the line says so). With claude, `plan`, `review` and `next --headless` also show what the AI is doing while it works: the files it reads, the commands it runs and, in `plan`, each file of the plan as it arrives. The analyst's instructions and the repository digest go to claude as a system prompt, which the provider caches between the interview's follow-up questions, the plan and its retries.

## Backends

| Backend | Runs | `plan` and `review` | `next` | Needs |
| --- | --- | --- | --- | --- |
| `claude` | `claude -p` | read-only tools (`Read`, `Grep`, `Glob`), without your MCP servers and connectors (`--strict-mcp-config`) or skills (`--disable-slash-commands`) | interactive session; `--headless` uses `--permission-mode acceptEdits` and `--allowedTools` for the task's commands | [Claude Code](https://code.claude.com) |
| `opencode` | `opencode run` | `plan` agent (no edits); `init` and `plan` show the model from `opencode.json` and warn when it looks free or small, or when none is set | interactive TUI; `--headless` uses the default build agent | [opencode](https://opencode.ai) |
| `codex` (experimental) | `codex exec` | `--sandbox read-only` | interactive session; `--headless` uses `--sandbox workspace-write` | [Codex CLI](https://github.com/openai/codex) |
| `gemini` (experimental) | `gemini -p` | `--approval-mode plan` | `gemini -i`; `--headless` uses `--approval-mode auto_edit` and `--allowed-tools` for the task's commands | [Gemini CLI](https://github.com/google-gemini/gemini-cli) |
| `api` (experimental) | HTTPS | single request with the digest | copy-and-paste flow, since an API cannot edit your repo | an API key |
| `manual` | you | prints the prompt, copies it to the clipboard, reads the answer from stdin or `.bae/tmp/response.md` | copy-and-paste flow | any AI, even a web chat |

`claude` and `opencode` are tested with real runs. `codex`, `gemini` and `api` are experimental: they are tested only against fakes of their CLIs and APIs. `init` detects which agent CLIs are installed and suggests the first one. Agent backends receive the prompt on stdin, get the repository digest, and may explore the repository themselves. The analyst never writes files: the CLI parses its answer and writes them. No backend is ever run with permission bypass (`--dangerously-skip-permissions`, `--yolo` and similar).

### Headless permissions

A headless agent cannot ask you before it runs a command, so bae tells it which commands the task needs: the project's lint, typecheck, build and test commands, the task's Verification commands that bae itself would run unattended, and the install commands of the toolchains they use (`npm install` and `npm ci` for npm, `uv sync` and `uv add` for uv, `go mod tidy` and `go get` for Go, and so on). Nothing is written to your agent's settings. If the agent is still denied a command it needed and the checks fail, the run stops at once, the task stays in progress without spending an attempt, and the message names the command to allow.

| Backend | How the commands reach the agent |
| --- | --- |
| `claude` | `--allowedTools` rules such as `Bash(npm test)` and `Bash(npm test *)`. Tested. |
| `gemini` | `--allowed-tools run_shell_command(<command>)`. Gemini CLI matches these exactly in non-interactive mode, so a command with other arguments is still denied. Not tested against a real Gemini CLI. |
| `opencode` | Nothing to pass: opencode allows shell commands unless your opencode config says otherwise. |
| `codex` | No per-command permissions. `--sandbox workspace-write` runs commands, but the sandbox has no network by default, so installing dependencies fails: install them before `next`, or allow network in your Codex config. |

### API backend

| Variable | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY` | Uses the Anthropic Messages API. The default model is `claude-opus-5`. |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | Any OpenAI-compatible endpoint: OpenAI, OpenRouter, Ollama (`http://localhost:11434/v1`, no key needed) and others. |
| `BAE_MODEL` | Model to use. Required for OpenAI-compatible endpoints. |
| `BAE_API_PROVIDER` | `anthropic` or `openai`, when both sets of variables are present. |
| `ANTHROPIC_BASE_URL` | Optional Anthropic-compatible proxy. |

## How `next` works

1. Picks the task in progress that still has attempts left, then the first pending task whose `depends_on` are all done, ordered by phase and id. A task in progress that used its attempts goes after the ready ones. A task with `status: needs_review` is skipped until you fix what its `review_note` says and set it back to `pending`.
2. Checks that the task can be verified at all. If its Verification is missing, trivial or refused, the task is marked `blocked` with the reason, and no agent is launched.
3. Works on the run's branch. The first `next` asks before it creates `bae/<date>-<time>` from the branch you are on and switches to it, and shows the name (`--yes` creates it without asking); later runs continue there. The branch is created only when the task is about to run: after its checks were accepted and the baseline recorded, so a stop before the agent leaves you on your branch. If you say no, you stay on your branch and finished tasks are not committed. If you are on another branch than the run's, `next` stops and says so; `--new-run` starts a new branch from where you are, for example after merging the previous one.
4. When the regression gate is `full`, runs the project's lint, typecheck, build and test commands to record a baseline. Then it marks the task `in_progress` and takes the capture: the current commit, the files that were already uncommitted, the ignore rules, the config, the task, the prompts, the reviewer and every file that defines the checks.
5. Hands it to the agent. The prompt opens with where the plan stands, the project commands and the handoff notes of the last three finished tasks. By default it opens an interactive session with the task as the first prompt; exit the session when you are done. With `--headless` the agent runs on its own with edits accepted, and stops after `agent.timeoutMinutes`.
6. Runs the gates below, always in the repository root. In an interactive run the commands are shown and you confirm them, with a warning for anything that looks dangerous. When nobody confirms (`--headless` or `--yes`), only known runners and checks run, including the ones in the repository's own virtualenv (`.venv/bin/python -m pytest`) and after leading `VAR=value` assignments (see `verify.allow`). Inline code (`node -e`, `python -c`, `ruby -e`…) and `curl` sending data (`-d`, `--data`, `-F`, `-T`, `--json`) to anything but 127.0.0.1 or localhost are refused unless `verify.allow` lists them. `plan` applies the same list, so a plan never asks for a command `next` would refuse.
7. If the agent exits with an error (for example the folder-trust question answered No, or a logged-out CLI) or changes no files, the gates do not run: the task stays `in_progress` with the reason. If a gate fails, the task stays `in_progress` and you see why. If every gate passes, the task is marked `done` and committed as a [conventional commit](https://www.conventionalcommits.org): `<type>: <title> (T-NNN)` with a `Bae-Task: T-NNN` trailer, where `type` comes from the task's frontmatter (`feat`, `fix`, `refactor`, `test`, `docs` or `chore`, the default). The title's first letter is lowercased when the next one is lowercase, so `Add the login page` becomes `add the login page` while acronyms such as `API` stay as written, and the header stays within 100 characters. The analyst starts every title with a verb, so commitlint's conventional config accepts the message; a title that starts with an acronym fails its `subject-case` rule (see [limits.md](limits.md#task-commits)). The commit holds the task file and the files the task changed, not the files that were already uncommitted before it. Your git hooks run as usual; `--no-verify` skips the pre-commit and commit-msg hooks. If a hook fails or git cannot commit, the task stays done, the commit stays pending and you see why. After the last task of the plan, `next` prints the command to open the pull request, `gh pr create --base <your branch> --head bae/<run>`, without running it.
8. With `--headless`, a failed attempt is retried with the task plus the failure output, unless the cause is the environment: the agent CLI missing, logged out or exiting with an error, a check that cannot find its program (exit 127), a command the agent was denied, a file the checks run that changed during the task (see [Gates](#gates)), or a reviewer that cannot answer. Another attempt would fail the same way, so the run stops at once with the cause; the task stays `in_progress`, and the stop neither counts as an attempt nor writes a lesson. A task gets three attempts in total, counted across runs of `next`, including attempts that timed out or changed no files; a task refused before the agent (see [Gates](#gates)) is blocked without spending one. After that the task is marked `blocked` with the reason, and the logs stay in the state directory (see [Files and safety](#files-and-safety)).

When something a gate needs cannot be had (no git repository, a declined or unusable baseline, a task that was already in progress without a capture, a reviewer with no verdict), `next` stops and says why instead of skipping it. `--allow-skip` goes on without that check and records the skip in the run log and the attempt.

## Gates

A task that fails a gate is not `done`. The `next` gates run in this order and read only the capture, never `.bae/` or the task file as the agent left them.

| Gate | When | What it does |
| --- | --- | --- |
| Evidence | `plan`, `replan` | Every path cited in the architecture, the ADRs and each task's Context must exist, and every `path:line` range must fit in the file. Files the plan will create are marked `(new)`. Wrong citations trigger one request that asks the analyst to fix only those. In a brownfield plan, a `path:line` citation that is still wrong stops the plan, and nothing is written. Paths without a line that stay unverified are listed under the summary and in `.bae/tmp/plan-report.json`. |
| Questions | `plan`, `replan` | Blocking questions are asked on the spot; the others are listed. All of them are saved to `.bae/interview.md`, and you can plan again right away with your answers. |
| Contract | `next` | These must not change while the agent works: the task file outside `## Log`, the other task files, `.bae/`, the agent definitions, settings and memory files, `.gitignore` and `.gitattributes`, `.git/config`, the `package.json` scripts, package manager settings (`.npmrc`, `.yarnrc*`, `bunfig.toml`, `.envrc`), test runner, `tsconfig` and lint configs, runner setup files and the scripts the checks execute, except build output (`dist/`, `build/`, `out/`, `target/`, `.next/` and the other folders the digest skips) and files git ignores, which the build writes again. Nothing may be added that would run instead of the project's tool (another Makefile, a local module that shadows one run with `python -m`), and no file may be marked unchanged in the git index. Anything that changed is restored and the attempt fails. When the only files that changed are scripts the checks run, `next` names each one with the command that runs it and stops without spending an attempt, because another attempt would fail the same way: ignore a generated file in `.gitignore`, list a file the task must change in its Scope, or change the check. The contract is checked after the agent, again after the suite and again after Verification, because both run the agent's code. When the task's Scope lists a `.gitignore`, a `package.json` or a runner, lint or `tsconfig` file, the change stays and the reviewer sees it, unless a script stops running a tool it ran or a setting that leaves tests out is added. Other files of this kind that are not bae's own may change when the Scope lists them and you accept the finding. |
| Regression | `next` | Runs the project's `lint`, `typecheck`, `build` and `test` commands and compares each one with its own baseline. A command that passed must still pass. A command whose tool or script does not exist yet (`No module named mypy` from `python -m mypy`, or npm's `Missing script`) is not compared while it stays missing: the task that creates it must make it pass, and one that removes it fails. For one that already failed, no test may fail that did not fail before, and its counts must not get worse. Test counts and failing names come from the runner's own report where it has one (vitest and jest JSON, pytest and `node --test` JUnit XML, `go test -json`, `dotnet test` TRX, and `cargo test`'s standard output), and from the last summary the runner prints otherwise. A test command whose runner bae does not recognize, or whose counts it cannot read, has an unknown verdict and never passes; `next` stops before launching the agent when it can tell in advance. One that already failed and has no counts only passes green. |
| Test integrity | `next` | Fewer tests run or more tests skipped than in the baseline blocks the task, unless the task's Scope marks the test file it removes with `(delete)`. From the diff, a deleted test file, a test removed and not added back under the same name, fewer assertion lines in any test file, a new `.skip`, `.only`, `.todo`, `skipIf`, `xit`, `@pytest.mark.skip`, `pytestmark`, `t.Skip`, `#[ignore]` or similar, a changed snapshot and a new runner config that leaves tests out also block. In a test file the Scope lists, those findings go to the reviewer instead, except expected-failure markers, and the reviewer must say why each one is correct or the review fails. A blanket suppression such as `@ts-ignore` blocks; one that names a rule goes to the reviewer. |
| Verification | `next` | The task's `## Verification` block runs as one bash script with `set -Eeuo pipefail`, so a failure anywhere, including inside a pipe, fails it. A block that runs no runner and no check, or that hides failures with `\|\| true`, is refused. A line that repeats a project command reuses its result, and a command that already failed and did not get worse does not block, unless the task is `tests: fix`. |
| Handoff note | `next` | A missing note, or one longer than 8 lines, under `## Log` is reported as a warning. |
| Mechanical review | `next`, `review` | On the task's diff: a `.env` or key file, an added token or key, a hard-coded password, credentials in a connection string or a long random string fails (known example keys are fine); `tests: required` fails unless the task runs more tests or adds assertions; files outside the task's Scope are reported. The AI reviewer only runs when nothing here blocks, and its pass never overrides a blocker. |
| Review | `next`, `review` | The generated reviewer checks the diff against the acceptance criteria and `AGENTS.md`. The diff puts the Scope files first and lockfiles last, and sits between markers the reviewer is told to treat as data. A reviewer that fails or gives no valid verdict stops the run without counting an attempt, and the task stays in progress. A task whose agent changed no files never reaches the gates. |
| Lessons | `next` | When a task ends `blocked` or fails its review twice, the agent proposes the root cause and a one-line rule. Once you approve it (`--yes` approves), the rule goes to a Lessons learned list in the managed block of `AGENTS.md`, which replans keep. |

Every finding a gate can accept has an id, printed next to it, such as `(secret-1a2b3c4d)`. `--accept-finding <id>` accepts it for that run, and the acceptance is recorded in the run log and the attempt. Secrets can always be accepted this way. Contract and test integrity findings on a file can be accepted only when the task's Scope lists that file.

## Configuration

`plan` fills the project's commands in `.bae/config.json`, first from the analyst and then from `package.json` scripts, Makefile targets, Python tools, `go.mod` or `Cargo.toml`. It never overwrites a command you set.

```json
{
  "commands": {
    "test": "npm test",
    "lint": "npm run lint",
    "typecheck": "npm run typecheck",
    "build": "npm run build"
  },
  "gates": { "regression": "full", "timeoutMinutes": 15 },
  "verify": { "allow": ["./scripts/check.sh"] },
  "secrets": { "allow": ["test/fixtures/**"] },
  "agent": { "timeoutMinutes": 45 }
}
```

- `gates.regression` is `full` (default: a baseline of lint, typecheck, build and test before the agent starts, compared after it), `task` (the same commands only after the task, so any failure blocks; cheaper when the suite is already green) or `off` (only the task's own Verification).
- `verify.allow` lists command prefixes that may run when nobody confirms them, besides the known runners and checks. A prefix matches with or without leading `VAR=value` assignments.
- `secrets.allow` lists path globs that the secret checks skip, such as test fixtures.
- `agent.timeoutMinutes` stops a headless agent that runs longer. The attempt is recorded.
- `gates.timeoutMinutes` (15 by default) stops a project command or a Verification block that runs longer; the command then counts as failed.

## Customizing prompts

The prompts live in [`src/prompts`](../src/prompts). To change one for a project, copy it to `.bae/prompts/<name>.md` and edit it; the CLI uses your copy instead. Every `{{variable}}` must stay defined, or the CLI stops with an error. `next` captures the prompts when it starts a task, so an override written while the agent works is removed and fails the attempt.

| Prompt | Variables |
| --- | --- |
| `analyst.md` | `mode`, `project_type`, `output_language`, `target_agents`, `interview`, `repo_digest`, `can_explore_repo`, `prior_plan`, `cli` |
| `task.md` | `context`, `task`, `task_path`, `max_log_lines`, `suite` (what `next` hands to the agent) |
| `review.md` | `reviewer`, `agents_md`, `task`, `diff`, `checks`, `output_language` |
| `retry.md` | `task`, `failure`, `attempt`, `task_path`, `max_log_lines` |
| `fix-format.md` | `error`, `format`, `previous_response` |
| `fix-paths.md` | `paths`, `files`, `repo_files` |
| `continue.md` | `prompt`, `partial`, `next_marker` |
| `lesson.md` | `reason`, `task`, `failures`, `agents_md`, `output_language` |

The analyst answers in a strict format (`<<<SUMMARY>>>`, `<<<QUESTIONS>>>`, `<<<CONFIG>>>` and `<<<FILE: path>>>` blocks). Known slips are repaired locally first: markers with extra spaces or in lowercase, and a missing `<<<END FILE>>>` on the last block when the backend reports that the answer ended normally. If the answer is cut off by the model's output limit, the CLI asks it to continue from the unfinished block (up to three times). An answer with no `<<<FILE: path>>>` block at all is not a plan: the CLI saves it to `.bae/tmp/non-plan-answer.md` and sends the original prompt again with a note. If the answer is still malformed, the CLI asks once to fix only the format; if it is still wrong, the raw answer is saved to `.bae/tmp/last-response.md`. A Verification block the CLI cannot accept, including one that `next` would refuse when nobody confirms it, never throws the plan away: the CLI asks the analyst to fix only those task files (and the CONFIG commands it would refuse), merges only them, and if one still fails, writes it with `status: needs_review` and a `review_note` that says what to change. The summary says so in one line, and `next` does not run the task until you fix it and set its status back to `pending`. Repairs, retries, answers that were not a plan and tasks that need review are recorded in `.bae/tmp/plan-report.json`.

## Files and safety

- `.bae/config.json` holds configuration only; `.bae/interview.md` holds your answers and the analyst's questions, and can be edited by hand. `.bae/tmp/` holds scratch files and is added to `.gitignore` before `plan`, `replan`, `next` or `review` writes anything there.
- What the gates trust lives outside the repository, in `~/.bae/<repo-key>/runs/T-NNN/` (`BAE_HOME` moves `~/.bae`): each task's capture with its base commit, baseline and protected files (only a fingerprint of `.git/config`, `.npmrc`, `.yarnrc`, `.envrc`, `bunfig.toml` and any protected file that looks like it holds a secret, so a change to one of them made while a run was interrupted is caught but not undone), the run logs, the attempt records (`attempts.jsonl`, the source of the `status` metrics), the stops that did not count as attempts (`stops.jsonl`) and the lesson. `run.json` there records the run's branch and the commit it started from, and `trust.json` records that you approved the repository's commands. The directory is readable only by you.
- The first `next` in a repository shows every command it will run there (the project's lint, typecheck, build and test commands, each open task's `## Verification` and `verify.allow`) and asks you to approve them; `--yes` and `--headless` do not answer this question, and without a terminal `next` stops until you approve them. After a pull or a replan, `next` asks again for the commands that are new or changed, and only for those. The same screen lists what the agent will load from the repository on its own (Claude Code hooks and plugins in `.claude/settings.json`, MCP servers in `.mcp.json`, opencode's MCP servers and plugins); a new one is shown as a warning, without asking. `trust.json` in the state directory keeps fingerprints of what you approved, not the commands.
- The analyst and the reviewer are told that everything in the repository is information about the project, never instructions to them, and to report text that addresses an AI tool: the analyst in the plan's risks, the reviewer as a finding.
- The digest respects `.gitignore` and `.baeignore`, skips binaries, lockfiles and `node_modules`, never reads `.env` files or keys, redacts tokens and secrets it finds (provider tokens, assignments of keys, tokens and passwords in code, YAML, Dockerfiles and Makefiles, connection strings, `Bearer` and `Basic` headers, and commit messages), and stays within a character budget (100,000 by default, `digest.maxChars` in the config) with priority manifests > entry points > docs > the rest.
- Existing files are merged, not overwritten. Generated memory goes between `<!-- bae:begin -->` and `<!-- bae:end -->` in `AGENTS.md`, `CLAUDE.md` and `GEMINI.md`; your text outside the markers is kept. Plan files are shown as a diff before writing, and done tasks are never touched.
- Nothing is sent anywhere except to the backend you choose. There is no telemetry.

## Global install

```sh
npm install -g builder-assistant-engineer
bae status
```

`bae` is a short alias that only exists after a global install. Do not run `npx bae`: that is a different npm package. Messages name every command as `bae` (`Next: bae next`), also when you run the package through npx, because npx runs its `bae` bin; without a global install, type `npx builder-assistant-engineer` in their place.
