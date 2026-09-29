# Known limits of the gates

The gates are built for an agent that makes mistakes or takes shortcuts while it edits the repository or runs the commands its CLI allows. The README describes that threat model. This page lists what stays open after the fourth adversarial review of milestone 0.3.0, so you know where to look when you review an agent's work.

The review used these rules. None of the items below is critical or high: those were fixed before the milestone closed.

- **Critical**: a mistake or a one-step shortcut leaves a task `done` although its checks would fail, and nothing in the report shows it.
- **High**: a mistake or a shortcut leaves a task `done` although its checks would fail. Blocking correct work is also high.
- **Medium**: a pattern, file name or format bae does not recognize (a coverage gap is medium at most), a bypass that needs code written to defeat the checks, or a shortcut the reviewer can still see.
- **Low**: robustness and messages.

To report a new case, including correct work that the gates stopped, use the [Report a bypass](../.github/ISSUE_TEMPLATE/report-bypass.yml) issue form.

## Outside the threat model

- **An agent with full access to your machine.** It can replace `npm`, `bash` or bae itself, edit dependencies inside ignored folders such as `node_modules`, or write to the state directory in your home.
- **Code written to deceive the checks.** The checks run the project's tests, which the agent may have written. Some examples of code that can defeat them on purpose:
  - a test that rewrites itself or another file while the suite runs, then puts it back, so the reviewer only sees the final tree;
  - a new `conftest.py` hook that rewrites test outcomes before pytest writes its report;
  - a test that prints summaries for a runner that bae reads from its printed output.
- **Agent permissions.** Claude Code ignores the permissions in a project's `.claude/settings.json` when a headless session runs in a folder you have not trusted. The agent can then edit files but cannot install dependencies or run tests. Tasks that need `npm install` fail at the gates. This is correct: the work is incomplete.

## Contract

- A new runner config is allowed, because greenfield tasks need it. This covers a `vitest.config` in a new folder, one that takes precedence over an existing `vite.config`, or a new `conftest.py`, and its setup files. The test counts and the reviewer still apply. (medium)
- Files changed inside a git submodule are not seen by the mechanical review. (medium)
- When the Scope lists a lint config or a script, the task may change it. A change that keeps running the same tool can still narrow what the tool checks, for example new ignore patterns or fewer files. The reviewer sees the change. (medium)
- Build files such as `pom.xml` or `build.gradle`, and the scripts of workspace packages other than the root `package.json`, are not protected. (medium)
- `.claude/settings.local.json` is not protected, because interactive agents write their permissions there. (low)

## Regression and test counts

- **Runners read from their printed summary** are mocha, bun, deno, unittest, rspec, minitest, phpunit, maven and playwright. For these runners:
  - only the last summary counts;
  - a failure swapped for another is not noticed for tests nested in `describe`, or for runners without failing names (bun, deno, minitest, maven). (medium)
- **A command that runs the runner several times** (`vitest run a && vitest run b`, or a Makefile with two pytest lines) is read from its last run only. (medium)
- **Commands next cannot read**: tox, gotestsum, `npm test --workspaces`, `cargo nextest`, `go test` without `-v` behind `make`, and vitest with its own `--outputFile`. For these, `next` stops before the agent. Point `commands.test` at the runner itself, or use `--allow-skip`. (medium)
- **Lint, typecheck and build commands:**
  - they are judged by their exit code;
  - when one already failed and has no counts, it is compared by its error lines, with line numbers left out;
  - an error that changes its wording counts as new;
  - a type error swapped for another with the same code in the same file is not noticed. (medium)
- **Renaming a test file in a suite that already fails** counts as a regression, because that unit stops reporting under its old name. (low)
- **In a repository whose suite already fails**, a Verification block made only of that suite command checks nothing about the task, so it is refused. (low)
- **One run decides a regression**, so a flaky test can block a task. (low)
- **With `gates.regression: task`** there is no baseline, so test counts are not compared. The checks on the diff still apply. (medium)

## Verification

- `if <check>; then …; fi` without an `else` does not fail when the check fails. (medium)
- The triviality rule accepts checks that cannot fail, such as `test -d src`, `diff f f`, or `grep` on a file the agent writes. (medium)
- A server may be started in the background (`python3 app.py &`, then `trap 'kill $!' EXIT`), but a check run in the background (`npm test &`) is refused, because its failure would be lost. (low)
- Lines are judged by their exit code alone. `go test ./... -run Missing` passes with no tests run. (medium)
- A package script that the same task creates can be a no-op, and a block that calls it passes. The reviewer sees the new script. (medium)
- Unattended runs refuse `$( )`, `eval`, `docker`, and scripts run by path (`./script.sh`); tools in the repository's `.venv/bin` or `venv/bin` are accepted when they are known runners. Use `sh script.sh`, or add a prefix to `verify.allow`. `plan` checks the same list and asks the analyst to fix what it would refuse. (low)
- A block written to cheat, with `trap 'exit 0' ERR` or an early `exit 0`, passes. The block comes from the plan, not from the agent. (low)
- With `pipefail`, a reader that stops early (`| head`, `| grep -q`) can fail a pipe that would otherwise pass. (low)

## Test integrity

- Rewriting a test in place to expect the broken value, with the same number of assertion lines, is left to the reviewer. (medium)
- Some markers, test file names, assertion styles, snapshot formats and suppression comments are not recognized:
  - markers such as `describe.todo`, `ctx.skip()`, `pending()`, TestNG `enabled = false`, `Assert.Ignore`, `XCTSkip` and `@tag :skip`;
  - Deno `_test.ts` files under `src/`, `androidTest/`, and `*.Tests` projects;
  - assertion styles such as gomega and kotest `shouldBe`;
  - snapshot formats such as `.verified.txt`, `.approved.txt` and trybuild `.stderr`;
  - suppressions such as `pyright: ignore`, `NOSONAR` and `swiftlint:disable`.

  The structured test counts still catch the ones that change how many tests run or skip. (medium)
- A runner setting that leaves tests out in a way the static check does not know, such as `testNamePattern`, mocha `spec`, `grepInvert` or `excludeSpecPattern`, is not flagged in a new config. The counts still apply. (medium)
- `tests: required` accepts a new test with a tautological assertion. (medium)
- Assertions offset by trivial new ones, and a test helper outside the test folders that stops asserting, are not flagged. This needs code written on purpose. (medium)
- A platform-specific skip that the task's goal requires needs `--accept-finding` on the platform where it skips. (low)
- Findings appear one stage at a time. A deleted test file is reported as a deletion and as removed tests. (low)

## Mechanical review, reviewer and evidence

- New files that are UTF-16 or contain a NUL byte are not scanned for secrets. (medium)
- A file force-committed under `.bae/tmp/` is not seen. This needs `git add -f`. (medium)
- A new file outside the code and test folders (a dotfolder, build output, or a top-level folder with no code or tests) that an ignore rule added during the task leaves out, such as a tool's cache listed in `.git/info/exclude` by its hook, is still scanned for secrets and test markers, but the reviewer only sees its name and it does not count against the Scope. Code, tests and anything in a code or test folder are always reviewed in full. (medium)
- Some secret formats are not recognized: Azure storage connection strings, JDBC and SQL Server passwords, `Bearer` headers, `whsec_`, SendGrid `SG.`, XML `<password>`, and strings split in two. (medium)
- Accepting a secret finding accepts other values of the same kind in the same file. (medium)
- The file names of out-of-scope changes appear in the reviewer's list of findings, outside the markers that hold the diff. (medium)
- Files under `node_modules`, `.venv`, `venv` or `bower_components` that the repository ignores after the task are not reviewed or scanned, so installed dependencies do not read as the task's code. A task whose Scope lists `.gitignore` could put code of its own there; the import that uses it still shows in the diff. (medium)
- Committed build output competes with source files for the reviewer's diff budget. (low)
- Evidence checks cited paths between backticks, not paths in prose. It does not check `file.ts:L10`, `file.ts:10,20` or Windows paths. (low)
- A bare Scope glob such as `*.ts` matches files at the repository root only. (low)

## Task commits

- The commit keeps an acronym at the start of a task title as written, and commitlint's conventional config rejects a subject that starts with an uppercase letter. The analyst starts titles with a verb; when a title still starts with an acronym, a commitlint hook rejects the commit, the task stays done and the commit stays pending with a warning. (low)
