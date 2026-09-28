# builder-assistant-engineer

Turn an idea, or an existing repository, into an execution plan that console AI agents can run on their own: Claude Code, opencode, Codex CLI, Gemini CLI or any other.

It acts as your tech lead and architect. It interviews you, analyzes the repository and writes files your agent reads as soon as it opens the repo: project memory (`AGENTS.md`), a phased plan, tasks that are ready-to-run prompts, and specialized subagents. Then it hands tasks to the agent one by one and only marks a task done after a series of [gates](#gates) pass: the task's own checks, no regressions in the project's lint, typecheck, build and tests, no tests removed or skipped, mechanical checks on the diff and a review. The gates read a capture taken before the agent starts, stored outside the repository, so an agent that edits the repository cannot rewrite what checks it. [What the gates protect against](#what-the-gates-protect-against) says exactly where that stops.

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

Requires Node.js 20.12 or newer, and bash for `next` (on Windows, the Git Bash that comes with Git for Windows). For `init`, `plan` and `next` you also need one of the [backends](#backends): an agent CLI you already use, an API key, or any AI you can copy and paste into.

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

The task's state lives in its frontmatter (`pending`, `in_progress`, `done`, `blocked`), so progress is versioned with your code. `tests: required` means the task must run more tests than before or add assertions to a test file. `tests: fix` marks a task whose goal is to repair failing tests: the project's test command must end green. `## Log` starts empty; the agent that finishes the task writes its handoff note there.

## Example

```text
$ npx builder-assistant-engineer status

Branch bae/2026-09-28-1015, created from main
  4f2c9a1 bae: T-001 Create a reproducible quality gate

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
| `plan` | Builds the repository digest, runs the analyst, checks the paths it cites and writes every artifact. `--only plan\|agents\|memory` writes one group. Shows a diff and asks before writing. |
| `next` | Takes the first task in progress, or the first pending task whose dependencies are done. Hands it to the agent and marks it done only when every [gate](#gates) passes, then commits it on the run's `bae/` branch. `--new-run` starts a new branch from the current one. `--headless` runs the agent without a session. `--allow-skip` goes on when a check cannot run and records the skip. `--accept-finding <id>` accepts one finding by its id (repeatable). |
| `status` | The run's branch and its commits, then phases, tasks, progress and local metrics: attempts per task, tasks done on the first attempt, regressions caught and time per task. |
| `replan` | Re-analyzes the repository with the finished work. Keeps done tasks, updates or removes pending ones, never reuses ids, and prepends an entry to `docs/plan/CHANGELOG.md`. During a run it must be on the run's branch, and commits the new plan there as `bae: replan`. |
| `review [task]` | Runs the mechanical checks and then the generated reviewer, read-only, on a task's diff against its acceptance criteria and `AGENTS.md`. Exits with 1 when the review fails. Defaults to the task in progress. Takes `--accept-finding <id>` too. |

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

1. Picks the task in progress that still has attempts left, then the first pending task whose `depends_on` are all done, ordered by phase and id. A task in progress that used its attempts goes after the ready ones.
2. Checks that the task can be verified at all. If its Verification is missing, trivial or refused, the task is marked `blocked` with the reason, and no agent is launched.
3. Works on the run's branch. The first `next` creates `bae/<date>-<time>` from the branch you are on and switches to it; later runs continue there. If you are on another branch, `next` stops and says so; `--new-run` starts a new branch from where you are, for example after merging the previous one.
4. When the regression gate is `full`, runs the project's lint, typecheck, build and test commands to record a baseline. Then it marks the task `in_progress` and takes the capture: the current commit, the files that were already uncommitted, the ignore rules, the config, the task, the prompts, the reviewer and every file that defines the checks.
5. Hands it to the agent. The prompt opens with where the plan stands, the project commands and the handoff notes of the last three finished tasks. By default it opens an interactive session with the task as the first prompt; exit the session when you are done. With `--headless` the agent runs on its own with edits accepted, and stops after `agent.timeoutMinutes`.
6. Runs the gates below, always in the repository root. In an interactive run the commands are shown and you confirm them, with a warning for anything that looks dangerous. When nobody confirms (`--headless` or `--yes`), only known runners and checks run (see `verify.allow`).
7. If a gate fails, the task stays `in_progress` and you see why. If every gate passes, the task is marked `done` and committed as `bae: T-NNN <title>`. The commit holds the task file and the files the task changed, not the files that were already uncommitted before it, and your git hooks do not run, since the gates already ran the checks. If git cannot commit, the task stays done and you see why.
8. With `--headless`, a failed attempt is retried with the task plus the failure output. A task gets three attempts in total, counted across runs of `next`, including attempts that ended because the agent failed or timed out. After that the task is marked `blocked` with the reason, and the logs stay in the state directory (see [Files and safety](#files-and-safety)).

When something a gate needs cannot be had (no git repository, a declined or unusable baseline, a task that was already in progress without a capture, a reviewer with no verdict), `next` stops and says why instead of skipping it. `--allow-skip` goes on without that check and records the skip in the run log and the attempt.

## Gates

A task that fails a gate is not `done`. The `next` gates run in this order and read only the capture, never `.bae/` or the task file as the agent left them.

| Gate | When | What it does |
| --- | --- | --- |
| Evidence | `plan`, `replan` | Every path cited in the architecture, the ADRs and each task's Context must exist, and every `path:line` range must fit in the file. Files the plan will create are marked `(new)`. Wrong citations trigger one request that asks the analyst to fix only those. In a brownfield plan, a `path:line` citation that is still wrong stops the plan, and nothing is written. Paths without a line that stay unverified are listed under the summary and in `.bae/tmp/plan-report.json`. |
| Questions | `plan`, `replan` | Blocking questions are asked on the spot; the others are listed. All of them are saved to `.bae/interview.md`, and you can plan again right away with your answers. |
| Contract | `next` | These must not change while the agent works: the task file outside `## Log`, the other task files, `.bae/`, the agent definitions, settings and memory files, `.gitignore` and `.gitattributes`, `.git/config`, the `package.json` scripts, package manager settings (`.npmrc`, `.yarnrc*`, `bunfig.toml`, `.envrc`), test runner, `tsconfig` and lint configs, runner setup files and the scripts the checks execute. Nothing may be added that would run instead of the project's tool (another Makefile, a local module that shadows one run with `python -m`), and no file may be marked unchanged in the git index. Anything that changed is restored and the attempt fails. The contract is checked after the agent, again after the suite and again after Verification, because both run the agent's code. When the task's Scope lists a `.gitignore`, a `package.json` or a runner, lint or `tsconfig` file, the change stays and the reviewer sees it, unless a script stops running a tool it ran or a setting that leaves tests out is added. Other files of this kind that are not bae's own may change when the Scope lists them and you accept the finding. |
| Regression | `next` | Runs the project's `lint`, `typecheck`, `build` and `test` commands and compares each one with its own baseline. A command that passed must still pass. For one that already failed, no test may fail that did not fail before, and its counts must not get worse. Test counts and failing names come from the runner's own report where it has one (vitest and jest JSON, pytest and `node --test` JUnit XML, `go test -json`, `dotnet test` TRX, and `cargo test`'s standard output), and from the last summary the runner prints otherwise. A test command whose runner bae does not recognize, or whose counts it cannot read, has an unknown verdict and never passes; `next` stops before launching the agent when it can tell in advance. One that already failed and has no counts only passes green. |
| Test integrity | `next` | Fewer tests run or more tests skipped than in the baseline blocks the task, unless the task's Scope marks the test file it removes with `(delete)`. From the diff, a deleted test file, a test removed and not added back under the same name, fewer assertion lines in any test file, a new `.skip`, `.only`, `.todo`, `skipIf`, `xit`, `@pytest.mark.skip`, `pytestmark`, `t.Skip`, `#[ignore]` or similar, a changed snapshot and a new runner config that leaves tests out also block. In a test file the Scope lists, those findings go to the reviewer instead, except expected-failure markers, and the reviewer must say why each one is correct or the review fails. A blanket suppression such as `@ts-ignore` blocks; one that names a rule goes to the reviewer. |
| Verification | `next` | The task's `## Verification` block runs as one bash script with `set -Eeuo pipefail`, so a failure anywhere, including inside a pipe, fails it. A block that runs no runner and no check, or that hides failures with `\|\| true`, is refused. A line that repeats a project command reuses its result, and a command that already failed and did not get worse does not block, unless the task is `tests: fix`. |
| Handoff note | `next` | A missing note, or one longer than 8 lines, under `## Log` is reported as a warning. |
| Mechanical review | `next`, `review` | On the task's diff: a `.env` or key file, an added token or key, a hard-coded password, credentials in a connection string or a long random string fails (known example keys are fine); `tests: required` fails unless the task runs more tests or adds assertions; files outside the task's Scope are reported. The AI reviewer only runs when nothing here blocks, and its pass never overrides a blocker. |
| Review | `next`, `review` | The generated reviewer checks the diff against the acceptance criteria and `AGENTS.md`. The diff puts the Scope files first and lockfiles last, and sits between markers the reviewer is told to treat as data. A reviewer with no valid verdict fails the attempt. A task that changed no files and passes its checks skips the reviewer. |
| Lessons | `next` | When a task ends `blocked` or fails its review twice, the agent proposes the root cause and a one-line rule. Once you approve it (`--yes` approves), the rule goes to a Lessons learned list in the managed block of `AGENTS.md`, which replans keep. |

Every finding a gate can accept has an id, printed next to it, such as `(secret-1a2b3c4d)`. `--accept-finding <id>` accepts it for that run, and the acceptance is recorded in the run log and the attempt. Secrets can always be accepted this way. Contract and test integrity findings on a file can be accepted only when the task's Scope lists that file.

### What the gates protect against

The gates are built for an agent that makes mistakes or takes shortcuts by editing the repository or running the commands its CLI allows: rewriting a test script, deleting, skipping or swapping a failing test, changing its own task or status, hiding files with `.gitignore`, git attributes, git config or index flags, overriding the review prompt, or crashing before the checks. Four rounds of adversarial review of the gates found 17, then 32, then 64 problems, and then 82 more in a round that also counted correct work the gates stopped; running `next` for real on the eval fixtures and on a real project found 5 more blocks of correct work. Each case that is in scope has an end-to-end test in [`test/e2e/bypass`](test/e2e/bypass) that tries it and checks that the gates stop it, and [`test/e2e/legit`](test/e2e/legit) runs correct and broken changes through real vitest, go, cargo, pytest and dotnet projects. Those tests run in CI on Linux, macOS and Windows. What stays open is listed in [docs/limits.md](docs/limits.md).

The checks run the project's tests, and the tests are code the agent may have written. That code runs with your permissions. bae checks its own state and the protected files after running it, restores anything that changed and fails the attempt, but it cannot stop code that attacks your machine on purpose, for example a process that keeps running after the checks end. For the same reason the gates do not protect against an agent with full access to your machine, which can replace `npm`, `bash` or this CLI, edit dependencies inside ignored folders such as `node_modules`, or write to the state directory in your home. Run agents with the permissions their CLI gives them (`--headless` never bypasses them), run untrusted work in a container, and review what they change.

Known limits, with the full list in [docs/limits.md](docs/limits.md):

- With `gates.regression: task` there is no baseline, so test counts are not compared (the checks on the diff still apply).
- Files in ignored folders, other git worktrees and submodules are outside what the gates see, although the runner may load them.
- Rewriting a test to expect the broken value is left to the reviewer.
- One run decides a regression, so a flaky test can block a task.
- Interactive runs never block a task on their own; after three failed attempts the task goes behind the ready ones.
- With `--yes`, a proposed lesson is added to `AGENTS.md` without asking.
- Headless agents in a folder you have not trusted in Claude Code cannot run commands, because Claude Code ignores the project's permissions there; tasks that need installs then fail their checks.

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
  "gates": { "regression": "full", "timeoutMinutes": 15 },
  "verify": { "allow": ["./scripts/check.sh"] },
  "secrets": { "allow": ["test/fixtures/**"] },
  "agent": { "timeoutMinutes": 45 }
}
```

- `gates.regression` is `full` (default: a baseline of lint, typecheck, build and test before the agent starts, compared after it), `task` (the same commands only after the task, so any failure blocks; cheaper when the suite is already green) or `off` (only the task's own Verification).
- `verify.allow` lists command prefixes that may run when nobody confirms them, besides the known runners and checks.
- `secrets.allow` lists path globs that the secret checks skip, such as test fixtures.
- `agent.timeoutMinutes` stops a headless agent that runs longer. The attempt is recorded.
- `gates.timeoutMinutes` (15 by default) stops a project command or a Verification block that runs longer; the command then counts as failed.

## Customizing prompts

The prompts live in [`src/prompts`](src/prompts). To change one for a project, copy it to `.bae/prompts/<name>.md` and edit it; the CLI uses your copy instead. Every `{{variable}}` must stay defined, or the CLI stops with an error. `next` captures the prompts when it starts a task, so an override written while the agent works is removed and fails the attempt.

| Prompt | Variables |
| --- | --- |
| `analyst.md` | `mode`, `project_type`, `output_language`, `target_agents`, `interview`, `repo_digest`, `can_explore_repo`, `prior_plan` |
| `task.md` | `context`, `task`, `task_path`, `max_log_lines`, `suite` (what `next` hands to the agent) |
| `review.md` | `reviewer`, `agents_md`, `task`, `diff`, `checks`, `output_language` |
| `retry.md` | `task`, `failure`, `attempt`, `task_path`, `max_log_lines` |
| `fix-format.md` | `error`, `format`, `previous_response` |
| `fix-paths.md` | `paths`, `files`, `repo_files` |
| `continue.md` | `prompt`, `partial`, `next_marker` |
| `lesson.md` | `reason`, `task`, `failures`, `agents_md`, `output_language` |

The analyst answers in a strict format (`<<<SUMMARY>>>`, `<<<QUESTIONS>>>`, `<<<CONFIG>>>` and `<<<FILE: path>>>` blocks). Known slips are repaired locally first: markers with extra spaces or in lowercase, and a missing `<<<END FILE>>>` on the last block when the backend reports that the answer ended normally. If the answer is cut off by the model's output limit, the CLI asks it to continue from the unfinished block (up to three times). If the answer is still malformed, the CLI asks once to fix only the format; if it is still wrong, the raw answer is saved to `.bae/tmp/last-response.md`. Repairs, retries and unverified paths are recorded in `.bae/tmp/plan-report.json`.

## Files and safety

- `.bae/config.json` holds configuration only; `.bae/interview.md` holds your answers and the analyst's questions, and can be edited by hand. `.bae/tmp/` holds scratch files and is added to `.gitignore`.
- What the gates trust lives outside the repository, in `~/.bae/<repo-key>/runs/T-NNN/` (`BAE_HOME` moves `~/.bae`): each task's capture with its base commit, baseline and protected files, the run logs, the attempt records (`attempts.jsonl`, the source of the `status` metrics) and the lesson. `run.json` there records the run's branch and the commit it started from.
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
