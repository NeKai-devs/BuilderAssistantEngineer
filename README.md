# builder-assistant-engineer

Turn an idea, or an existing repository, into an execution plan that console AI agents can run on their own: Claude Code, opencode, Codex CLI, Gemini CLI or any other.

It acts as your tech lead and architect. It interviews you, analyzes the repository and writes files your agent reads as soon as it opens the repo: project memory (`AGENTS.md`), a phased plan, tasks that are ready-to-run prompts, and specialized subagents. Then it hands tasks to the agent one by one and only marks a task done after a series of [gates](docs/reference.md#gates) pass: the task's own checks, no regressions in the project's lint, typecheck, build and tests, no tests removed or skipped, mechanical checks on the diff and a review. The gates read a capture taken before the agent starts, stored outside the repository, so an agent that edits the repository cannot rewrite what checks it. [What the gates protect against](#what-the-gates-protect-against) says exactly where that stops.

- Zero friction: `npx builder-assistant-engineer` inside your project. No API key required if you already use an agent CLI.
- Native output for each agent: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.claude/agents`, `.opencode/agent`, slash commands.
- Greenfield and brownfield: proposes a stack for new projects, and inventories stack, architecture, conventions, tests, debt and risks (with file paths as evidence) for existing ones.
- English and Spanish (`--lang en|es`). MIT. No telemetry.

## Quickstart (60 seconds)

You need Node.js 20.12 or newer, git, and an agent CLI you already use and are logged in to: [Claude Code](https://code.claude.com), [opencode](https://opencode.ai), [Codex CLI](https://github.com/openai/codex) or [Gemini CLI](https://github.com/google-gemini/gemini-cli) (Codex CLI, Gemini CLI and the API backend are experimental; copy and paste also works, see [Backends](docs/reference.md#backends)). On Windows, run the commands in Git Bash; agent sessions on Windows are not verified yet (see [Platform support](#platform-support)).

```sh
cd your-project                       # new idea? mkdir my-idea && cd my-idea && git init
npx builder-assistant-engineer init   # pick language, project type, AI and agents; answer the interview (Enter skips)
npx builder-assistant-engineer plan   # writes AGENTS.md, docs/plan/ and one file per task (10 to 40 minutes, naming each file as it arrives), then offers to commit them
npx builder-assistant-engineer next   # creates a bae/ branch and opens your agent on the first task
```

Exit the agent when the task is finished. `next` then runs the task's checks, the project's lint and tests and a review. If they pass, it marks the task done and commits it on the branch; if not, it says why, and you run `next` again. Run `next` once per task, or `next --headless` to let the agent work alone with up to three attempts. In a headless run bae lets the agent run the task's checks and install dependencies, and nothing else it would have to ask for; if the agent is denied a command it needed, the task stops at once and names the command to allow (see [Headless permissions](docs/reference.md#headless-permissions)). If a task ends `blocked`, fix the cause, set `status: pending` in its file and run `next` again. After the last task, `next` prints the command that opens the pull request. `npx builder-assistant-engineer status` shows where you are. Messages name every command as `bae`, for example `Next: bae next`, also when you run bae through npx; without a [global install](docs/reference.md#global-install), type `npx builder-assistant-engineer next` instead.

Tried it? Tell us how it went with the [First impression](https://github.com/NeKai-devs/BuilderAssistantEngineer/issues/new?template=first-impression.yml) form, even if you stopped halfway.

## Documentation

- [User manual](docs/manual/es/manual.md), in Spanish, also as a [PDF](docs/manual/bae-manual-es.pdf): what bae is and is not, first use, how it works, how to get the most out of it, security and privacy, the most common messages and a command reference. Only in Spanish for now.
- [Reference](docs/reference.md): what `plan` writes, every command and flag, backends, how `next` works, each gate, configuration, prompts, and files and safety.
- [Known limits](docs/limits.md): what the gates leave open.

## Real-world run

nekai-pos is a private desktop point-of-sale app (Tauri 2, React and TypeScript, encrypted SQLite). bae 0.2.0 planned one feature from its roadmap, formatting money and dates by locale, and ran it with `next --headless`, with Claude Code (claude-opus-5-5) as the agent and the reviewer.

| | |
| --- | --- |
| Tasks | 9 of 9 done |
| Attempts | 15; 6 tasks done on the first attempt |
| Correct blocks | 3. Verification caught a hard-coded «Q» currency symbol still in a file, and a required test file that was missing. The reviewer held a plan criterion no code could meet (`"Q1,234.50"`, while the ICU puts a non-breaking space after «Q»), and the contract undid the agent's edits to other task files. The criterion was fixed in the plan and the task passed. |
| False blocks | 1. A Claude Code plugin hook wrote a cache file in the middle of a task and the reviewer flagged it; fixed before release. |
| Agent and gate time | 3.6 hours in total, 14 to 31 minutes per task |
| Change | 68 files, +2,971 and −296 lines, 16 test files |
| Cost | Not recorded. bae does not log the agent's cost in `next`, and the run used a Claude subscription, whose usage limit cut it twice; attempts cut that way are not counted above. |

Two things came out of it. The analyst now keeps every acceptance criterion within what the task can change and check, and anything external goes under Risks. And `next` now commits each task on its own branch, where nekai-pos needed that branch rebuilt by hand. The headless agents could not run commands, because Claude Code ignores a project's `.claude/settings.json` permissions in a folder it has not trusted; bae now passes the task's commands to the agent itself.

## What the gates protect against

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

## Platform support

- **Linux and macOS**: the CLI, the digest, the gates and the test suite are verified in CI; agent sessions have been run for real on Linux.
- **Windows (Git Bash)**: the CLI, the digest, the gates and the test suite are verified in CI. Agent sessions on Windows are not verified.

CI runs lint, typecheck, every test (the gate bypass tests included) and the build on the three systems with Node 20 and 24; six tests that depend on POSIX behavior (process groups, file modes, file names with `*` or `?`, a Unix virtualenv layout, a missing program's exit code) are skipped on Windows. This section is updated when someone runs bae on a real Windows machine: if you do, tell us with the [First impression](https://github.com/NeKai-devs/BuilderAssistantEngineer/issues/new?template=first-impression.yml) form.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
