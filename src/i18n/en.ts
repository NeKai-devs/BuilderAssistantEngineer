export const en = {
  "program.description":
    "Turn an idea or an existing repo into an execution plan for console AI agents.",
  "option.backend": "AI backend to use",
  "option.lang": "language for the CLI and the generated artifacts",
  "option.dryRun": "show exactly what would be sent to the AI without writing anything",
  "option.yes": "accept every confirmation",
  "option.help": "show help",
  "option.version": "show version",
  "option.only": "generate only one group of artifacts",
  "option.headless": "run the agent without an interactive session (accept edits, never bypass)",
  "command.init": "detect the project, choose backend, agents and language, and run the interview",
  "command.plan": "analyze the repo and generate the plan, memory and agents",
  "command.next": "run the next pending task, verify and review it, and mark it done",
  "command.status": "show phases, tasks and progress",
  "command.replan": "re-analyze the repo, keep finished work and update pending tasks",
  "command.review": "review a task's diff against its acceptance criteria and AGENTS.md",
  "command.help": "show help for a command",
  "option.brief": "comma-separated files with your brief or docs (skips pasting)",
  "ui.cancelled": "Cancelled.",
  "format.retrying":
    "The answer did not follow the output format; asking once more to fix only the format.",
  "format.failed":
    "The answer still does not follow the output format ({{details}}). Raw output saved to {{path}}.",
  "init.intro": "builder-assistant-engineer · setup",
  "init.lang": "Language for the CLI and the generated plan",
  "init.mode": "Project type",
  "init.detected": "detected",
  "init.backend": "Which AI should run the analysis?",
  "init.backendMissing": "`{{command}}` was not found in PATH; install it before running plan.",
  "init.targets": "Which agents will work on this repo?",
  "init.redoInterview": "An interview already exists in .bae/interview.md. Redo it?",
  "init.briefMissing": "Could not read the brief file(s): {{path}}",
  "init.dryRunNoAi": "Dry run: nothing would be sent to the AI during init.",
  "init.dryRunDone": "Dry run finished. Nothing was written.",
  "init.done": "Setup saved in .bae/. Next: {{command}}",
  "mode.greenfield": "Greenfield — new project, little or no code yet",
  "mode.brownfield": "Brownfield — existing codebase",
  "backend.label.manual": "Manual (copy and paste)",
  "backend.hint.installed": "installed",
  "backend.hint.missing": "not found in PATH",
  "backend.hint.api": "Anthropic or OpenAI-compatible key via environment variables",
  "backend.hint.apiReady": "credentials found in the environment",
  "backend.hint.manual": "works with any AI, even a web chat",
  "interview.intro": "Interview — press Enter to skip any question.",
  "interview.brief":
    "Brief: paste a one-line summary, or paths to files with your brief or docs (comma-separated)",
  "interview.briefPlaceholder": "e.g. docs/brief.md, notes/idea.md",
  "interview.briefLoaded": "Loaded {{count}} file(s): {{paths}}",
  "interview.objective": "What is the goal for this repo?",
  "interview.q.what": "What do you want to build, and for whom?",
  "interview.q.problem": "What problem does it solve, and how will you know it works?",
  "interview.q.scope": "What is in the first deliverable, and what stays out?",
  "interview.q.constraints":
    "Constraints: required stack, deadlines, platforms, integrations, budget?",
  "interview.q.team": "Who will execute the plan (AI only, you + AI, a team), and at what level?",
  "interview.q.rules":
    "Preferences and prohibitions: conventions, parts of the repo that must not be touched?",
  "interview.followUps": "The analyst may ask up to {{max}} follow-up questions.",
  "interview.thinking": "Thinking about the next question…",
  "interview.other": "Other (type it)",
  "interview.skip": "Skip",
  "interview.answer": "Your answer",
  "interview.adaptiveFailed": "Skipping the remaining follow-up questions: {{details}}",
  "interview.adaptiveManual": "Follow-up questions are skipped with the manual backend.",
  "objective.feature": "Build a new feature",
  "objective.refactor": "Refactor",
  "objective.migration": "Migrate (framework, language, infrastructure)",
  "objective.bugs": "Fix bugs",
  "objective.docs": "Document the codebase",
  "md.interview": "Interview",
  "md.mode": "Mode",
  "md.objective": "Goal",
  "md.brief": "Brief",
  "md.followUps": "Follow-up questions",
  "md.summary": "Summary",
  "md.skipped": "skipped",
  "config.missing": "No configuration found in .bae/config.json. Run {{command}} first.",
  "digest.reading": "Reading the repository…",
  "plan.intro": "builder-assistant-engineer · plan",
  "plan.noInterview": "No interview in .bae/interview.md; planning from the repository alone.",
  "plan.analyzing": "{{backend}} is writing the plan; this usually takes 10–40 minutes",
  "plan.progressStep": "{{backend}} is writing the plan (10–40 min) · {{step}}",
  "plan.progressFiles":
    "{{backend}} is writing the plan (10–40 min) · {{count}} file(s) · {{file}}",
  "usage.summary": "Took {{time}} · AI cost {{cost}}",
  "usage.notReported": "not reported by {{names}}",
  "usage.partlyReported": "{{cost}}, plus calls to {{names}} that do not report their cost",
  "next.attemptUsage": "This attempt took {{time}} · AI cost {{cost}}",
  "next.costUnknown": "not reported (an interactive session or a backend that does not report it)",
  "progress.thinking": "thinking",
  "progress.read": "reading {{detail}}",
  "progress.search": "searching {{detail}}",
  "progress.run": "running {{detail}}",
  "progress.edit": "editing {{detail}}",
  "progress.tool": "{{tool}} {{detail}}",
  "plan.existingPlan":
    "A plan already exists in docs/plan/tasks. Regenerate it from scratch? (replan keeps progress)",
  "plan.useReplan": "Nothing changed. Use replan to update the plan and keep finished work.",
  "plan.dryRunDone":
    "Dry run: the prompt above is exactly what would be sent. Nothing was written.",
  "plan.continuing":
    "The answer was cut off at {{marker}}; asking the analyst to continue from there.",
  "plan.summary": "Summary",
  "plan.blocking": "blocking",
  "plan.done": "{{count}} file(s) written. Next: {{next}}",
  "plan.nothingWritten": "No files were written.",
  "artifacts.changes": "Changes",
  "artifacts.confirm": "Write {{count}} file(s)?",
  "artifacts.all": "Write all",
  "artifacts.each": "Review one by one",
  "artifacts.none": "Write nothing",
  "artifacts.confirmOne": "Write {{path}}?",
  "artifacts.new": "new, {{lines}} lines",
  "artifacts.updated": "+{{added}} −{{removed}}",
  "artifacts.unchanged": "unchanged",
  "artifacts.keptDone": "done task, kept as is",
  "tasks.invalid": "Ignoring an invalid task file: {{error}}",
  "next.intro": "builder-assistant-engineer · next",
  "next.meta": "phase {{phase}} · size {{size}} · risk {{risk}} · depends on {{deps}}",
  "next.dryRunDone":
    "Dry run: the task above is exactly what the agent would receive. Nothing changed.",
  "next.headlessNeedsAgent":
    "--headless needs an agent CLI backend (claude, opencode, codex, gemini); running the manual flow instead.",
  "next.launching":
    "Opening {{backend}} with the task. Exit the session when the task is finished.",
  "next.attempt": "Attempt {{attempt}} of {{max}} with {{backend}} (headless, accept edits)",
  "next.done": "{{id}} is done. Next: {{command}}",
  "next.notDone": "{{id}} stays in progress. Fix it and run {{command}} again.",
  "trust.title": "Commands this repository makes bae run",
  "trust.suite": "Project commands, before and after every task:",
  "trust.checks": "Task checks (## Verification):",
  "trust.allowed": "Also allowed when nobody confirms (verify.allow in .bae/config.json):",
  "trust.confirm":
    "bae has not run anything in this repository on this machine yet. It will run the commands above with your permissions, also under --yes and --headless, which do not answer this question. Do you trust them?",
  "trust.changedTitle": "Commands that are new or changed since you approved this repository",
  "trust.confirmChanged":
    "These commands are new or changed since you last approved this repository's commands, for example after a pull or a replan. bae will run them with your permissions, also under --yes and --headless, which do not answer this question. Do you trust them?",
  "trust.agentLoads":
    "The agent will also load these from the repository when it starts (bae does not run them itself; check them before you go on):",
  "trust.declined":
    "Nothing was run. Read .bae/config.json and the ## Verification blocks in docs/plan/tasks, then run {{command}} again.",
  "trust.noTerminal":
    "Before bae runs this repository's commands for the first time, a person must approve them, and there is no terminal to ask in. Run {{command}} once in a terminal to approve them.",
  "next.noChanges": "The agent changed no files for {{id}}, so bae did not run its checks.",
  "next.stopped":
    "{{reason}}\n{{id}} stays in progress, and this run does not count as one of its attempts. Fix the cause and run {{command}} again.",
  "next.stoppedTitle": "Stopped before the checks (not counted as an attempt)",
  "next.nothingRun": "Nothing was run. Fix the cause and run {{command}} again.",
  "next.blocked":
    "{{id}} is blocked: {{reason}} Logs: {{path}}. To try again, fix the cause, set `status: pending` in {{task}} and run {{command}}.",
  "next.noPlan": "There are no tasks yet. Run {{command}} first.",
  "next.allDone": "Every task is done.",
  "next.nothingReady": "No task is ready",
  "next.unblock":
    "Fix what a task that needs review says in its file and set its status to pending, unblock or finish the other tasks above, or run replan.",
  "verify.commands": "Verification",
  "verify.confirm": "Run these verification commands now?",
  "verify.declined": "Verification was not run; the task stays in progress.",
  "verify.none": "The task has no verification commands in a ```sh block under Verification.",
  "verify.failed": "Verification failed: `{{command}}` exited with {{code}}.",
  "verify.passed": "Verification passed.",
  "verify.stillFailing":
    "`{{command}}` failed before the task and still fails (exit {{code}}), so it did not block. If an acceptance criterion needs it to pass, the task is not done.",
  "review.intro": "builder-assistant-engineer · review",
  "review.running": "The reviewer is checking {{id}}…",
  "review.findings": "Review findings",
  "review.passed": "Review passed.",
  "review.failed": "Review failed for {{id}}.",
  "review.noGit": "Review skipped: this is not a git repository, so there is no diff to review.",
  "review.noChanges":
    "The task changed no files and its checks pass, so the reviewer was not called.",
  "review.dryRun": "Dry run: the review prompt above was not sent.",
  "review.noTask": "No task is in progress. Pass a task id, e.g. review T-003.",
  "review.unknownTask": "Task {{id}} was not found in docs/plan/tasks.",
  "status.empty": "No plan yet. Run {{command}} first.",
  "status.phase": "Phase {{phase}}",
  "status.waiting": "waiting on {{ids}}",
  "status.total": "{{done}}/{{total}} done ({{percent}}%)",
  "status.next": "next: {{id}} {{title}}",
  "status.noNext": "no task ready",
  "replan.intro": "builder-assistant-engineer · replan",
  "replan.noPlan": "There is no plan to update. Run {{command}} first.",
  "replan.noChangelog": "The analyst did not write docs/plan/CHANGELOG.md.",
  "artifacts.removed": "removed, no longer in the plan",
  "argument.task": "task id, e.g. T-003 (defaults to the task in progress)",
  "error.configJson": "{{path}} is not valid JSON: {{details}}",
  "error.configInvalid": "{{path}} is invalid:\n{{details}}",
  "error.promptMissingVars": "{{path}} uses variables that were not provided: {{vars}}",
  "error.unexpected": "Unexpected error. Please report it with the output below.",
  "backend.notInstalled":
    "`{{command}}` is not installed or not in PATH. Install it or pick another backend with --backend.",
  "backend.timedOut":
    "`{{command}}` did not finish within {{minutes}} minutes and was stopped (agent.timeoutMinutes in .bae/config.json).",
  "backend.failed": "`{{command}}` exited with code {{code}}:\n{{details}}",
  "backend.sessionFailed":
    "`{{command}}` exited with code {{code}} before the task was finished (for example the folder-trust question was answered No, the CLI is logged out, or it crashed), so bae ran no checks.",
  "backend.apiNotConfigured":
    "The api backend needs ANTHROPIC_API_KEY, or OPENAI_BASE_URL/OPENAI_API_KEY for an OpenAI-compatible endpoint.",
  "backend.apiModelRequired": "Set BAE_MODEL to the model to use with {{baseUrl}}.",
  "backend.apiProviderInvalid": "BAE_API_PROVIDER must be anthropic or openai, not {{provider}}.",
  "backend.apiHttp": "{{provider}} API error ({{status}}): {{details}}",
  "backend.apiNetwork": "Could not reach {{url}}: {{details}}",
  "backend.apiInteractive": "The api backend cannot run an interactive session.",
  "backend.refusal": "The model declined the request.",
  "backend.truncated": "The response hit the output token limit and is incomplete.",
  "manual.copied": "Prompt copied to the clipboard and saved to {{path}}.",
  "manual.notCopied": "Could not use the clipboard; the prompt is saved to {{path}}.",
  "manual.awaitingResponse":
    "Paste it into your AI. Then paste the full answer here and finish with Ctrl-D (Ctrl-Z, Enter on Windows), or save it to {{path}} and press Enter.",
  "manual.awaitingDone": "Run it with your agent and press Enter when the task is finished.",
  "manual.emptyResponse": "No answer received. Paste it here or save it to {{path}}.",
  "plan.commands": "Project commands saved to .bae/config.json",
  "regression.title": "Regression check",
  "regression.baselineTitle": "Regression baseline, before the task",
  "regression.confirm": "Run the project's lint and test commands now to record the baseline?",
  "regression.preexisting":
    "`{{command}}` already fails before the task (exit {{code}}); recorded as preexisting, it will not block.",
  "regression.found": "Regression: `{{command}}` exits with {{code}} after the task.",
  "regression.stillFailing":
    "`{{command}}` still fails (exit {{code}}), as it did before the task.",
  "regression.passed": "Regression check passed.",
  "evidence.retrying":
    "{{count}} cited path(s) are not in the repository and not marked (new); asking the analyst to fix only those.",
  "evidence.fixing": "The analyst is fixing the cited paths…",
  "evidence.fixed": "Every cited path now exists or is marked (new).",
  "evidence.unverified":
    "{{count}} cited path(s) are still unverified; they are listed in the summary.",
  "evidence.summary": "Unverified paths (not in the repository and not marked new):",
  "mechanical.secretFile":
    "Looks like a secrets file (.env, private key or credentials); keep it out of the change.",
  "mechanical.secretValue":
    "Adds what looks like a credential ({{kind}}); read it from the environment instead.",
  "mechanical.noTests":
    "The task requires tests (tests: required), but it neither runs more tests than before nor adds assertions to a test file.",
  "mechanical.outOfScope": "Changed outside the task's Scope: {{files}}",
  "mechanical.failed": "The automatic checks failed, so the reviewer was not run.",
  "plan.openQuestions":
    "Open questions, saved to .bae/interview.md; answer them there and run replan when you can",
  "plan.questionsSaved": "{{count}} question(s) saved to .bae/interview.md.",
  "plan.rerun": "You answered blocking questions. Run the plan again now with your answers?",
  "plan.rerunning": "Running the plan again with your answers.",
  "md.planQuestions": "Questions from the plan ({{date}})",
  "md.why": "Why",
  "md.options": "Options",
  "md.blocking": "Blocking: the plan assumed an answer",
  "md.answer": "Answer",
  "md.open": "open, not answered yet",
  "handoff.missing":
    "{{path}} has no handoff note: write at most {{max}} lines under ## Log (what changed, decisions, traps).",
  "handoff.tooLong": "The handoff note in {{path}} has {{count}} lines; keep it to {{max}}.",
  "handoff.passed": "Handoff note present.",
  "md.lessons": "Lessons learned",
  "lesson.asking": "{{id}} failed repeatedly; asking the agent for the root cause and a rule…",
  "lesson.title": "Lesson from {{id}}",
  "lesson.body": "Root cause: {{cause}}\nRule: {{rule}}",
  "lesson.confirm": "Add this rule to AGENTS.md?",
  "lesson.added": "Rule added to AGENTS.md.",
  "lesson.skipped": "Rule not added; it stays in {{path}}.",
  "lesson.failed": "Could not get a lesson from the agent: {{details}}",
  "status.blockedReason": "{{id}} is blocked: {{reason}}",
  "status.stoppedReason": "{{id}} stopped: {{reason}}",
  "opencode.model": "opencode will use {{model}} (from {{source}}).",
  "opencode.weakModel":
    'opencode will use {{model}} (from {{source}}), which looks like a free or small model. A plan needs a strong model: pass --backend claude, or set a stronger "model" in opencode.json.',
  "opencode.noModel":
    'opencode has no "model" in opencode.json, so it will use its own default, which may be a free model. A plan needs a strong model: pass --backend claude, or set "model" in opencode.json.',
  "plan.notAPlan":
    "The answer ({{chars}} characters) has no plan files, so it is not a plan; asking again with the full prompt. The answer is saved in {{path}}.",
  "plan.needsReviewWarn":
    "{{count}} task(s) still have a Verification the CLI cannot accept: {{ids}}. They are written with status needs_review, and next will not run them until they are fixed.",
  "plan.needsReview":
    "{{count}} task(s) need review before next can run them: {{ids}}. Each file's review_note says what to fix in its Verification; then set its status to pending.",
  "verification.commandsRetrying":
    "Some project commands in the plan are ones bae does not run when nobody confirms them; asking the analyst to fix only those:\n{{notes}}",
  "verification.commandsKept":
    "These project commands stay in .bae/config.json, but next --headless and next --yes will refuse them until you change them or add their first words to verify.allow in .bae/config.json:\n{{notes}}",
  "verification.retrying":
    "{{count}} task(s) have a Verification the CLI cannot accept: {{kinds}}. Asking the analyst to fix only those. Details in {{report}}.",
  "verification.fixing": "The analyst is fixing the Verification of those tasks",
  "verification.fixed": "Every Verification is fixed.",
  "verification.retryFailed": "The request to fix the Verification failed: {{details}}",
  "status.reviewReason": "{{id}} needs review: {{reason}}",
  "next.needsReview": "needs review: {{note}}",
  "status.metrics": "Local metrics",
  "status.attempts": "attempts: {{attempts}} over {{tasks}} task(s), {{average}} per task",
  "status.firstAttempt": "done on the first attempt: {{count}}/{{tasks}} ({{percent}}%)",
  "status.regressions": "regressions caught: {{count}}",
  "status.cost":
    "AI cost: {{cost}} over the {{priced}} of {{attempts}} attempt(s) that reported it",
  "status.time": "time per done task: {{average}} on average, {{total}} in total",
  "status.taskRuns": "{{attempts}} attempt(s), {{time}}",
  "format.repaired": "Repaired the answer locally: {{repairs}}.",
  "evidence.retryFailed":
    "The request to fix the cited paths failed, so the plan keeps them as they are: {{details}}",
  "regression.noCommands":
    "No lint or test command in .bae/config.json or the manifests; the regression check is off until you add them under commands.",
  "option.acceptFinding":
    "accept one finding by its id (repeatable); only secrets, and contract or test findings on files the task's Scope lists",
  "review.noBase":
    "Review failed: the commit recorded when the task started no longer exists, so the task's changes cannot be isolated.",
  "review.noCapture": "{{id}} has no capture from next; reviewing it against the current HEAD.",
  "contract.title": "Contract",
  "contract.failed":
    "The task changed files that define its own checks; they were restored from the state captured before the task.",
  "contract.recovered":
    "An earlier run of {{id}} ended before its checks; the files it changed that define the checks were restored.",
  "contract.task": "Edited the task file outside ## Log.",
  "contract.tasks": "Edited another task file.",
  "contract.bae": "Changed bae's own configuration or prompts.",
  "contract.agents": "Changed an agent definition or the agent settings the reviewer runs with.",
  "contract.gitignore": "Changed an ignore file, which decides what the review sees.",
  "contract.scripts": "Changed {{detail}}, which the checks run.",
  "contract.runner": "Changed the test runner configuration.",
  "contract.restored": "Restored.",
  "contract.sealed":
    "bae keeps only a fingerprint of this file, because it can hold credentials, so it could not restore it: check it and put it back by hand.",
  "contract.removed": "Removed.",
  "findings.accepted": "Accepted with --accept-finding.",
  "findings.acceptedTitle": "Accepted findings",
  "regression.failed": "The regression check failed.",
  "regression.mustPass":
    "`{{command}}` still fails (exit {{code}}), and the task is tests: fix, so the test suite must end green.",
  "regression.uncomparable":
    "`{{command}}` already failed before the task and still fails (exit {{code}}); its output has no counts to compare, so only green passes.",
  "regression.worse":
    "Regression: `{{command}}` fails more checks than before the task ({{now}}; before: {{before}}).",
  "regression.lateStop": "{{id}} has no regression baseline from before its agent ran.",
  "regression.declinedStop":
    "Without running lint and tests first there is no baseline, so the task could not be done.",
  "regression.noToolchain":
    "No toolchain yet: the repository has no code or project manifest, so there is no baseline to record. {{id}} sets it up, and the project's lint and test commands must pass after it.",
  "regression.notFound":
    "`{{command}}` could not find a program it runs (exit 127), so there is no baseline. Install the project's dependencies (for example `npm install`) and run next again.",
  "regression.unusable":
    "`{{command}}` gives no usable baseline (exit {{code}}): it did not finish, or it fails with no counts to compare. The task could not be done while it stays red.",
  "review.noVerdict": "The reviewer gave no verdict.",
  "review.error": "The reviewer could not give a verdict: {{details}}",
  "skip.used": "Going on without this check because of --allow-skip: {{what}}",
  "skip.title": "Skipped with --allow-skip",
  "skip.stopped":
    "Nothing was launched. Fix the cause, or run next again with --allow-skip to go on without that check; the skip is recorded in the run log.",
  "env.denied":
    "{{agent}} was not allowed to run {{commands}}, so another attempt would fail the same way. bae lets the agent run the task's checks and install dependencies; allow the rest in {{agent}}'s own permissions (for Claude Code, a rule such as `Bash({{first}} *)` in .claude/settings.json of a folder you trust), or run next without --headless and approve it yourself.",
  "env.alsoDenied": "{{agent}} was also not allowed to run {{commands}}.",
  "env.moreDenied": "and {{count}} more",
  "env.notFound":
    "`{{command}}` could not find a program it runs (exit 127): the project's dependencies are not installed, or a tool is missing. Another attempt would fail the same way; install them (for example `npm install`).",
  "next.budgetUsed": "The task already used its {{max}} automatic attempts.",
  "next.refusedBlocked":
    "{{id}} is blocked before launching the agent, because its checks cannot run; nothing was run and it does not count as an attempt. Fix the task's Verification or the commands in .bae/config.json, then set `status: pending` in {{task}}.",
  "capture.lateStop":
    "{{id}} is in progress without a capture from before its agent ran, so its checks have no trustworthy starting point. Set it back to pending, or run with --allow-skip.",
  "capture.noGit": "This is not a git repository, so the review cannot see the task's changes.",
  "option.allowSkip":
    "go on when a check cannot run (no git, no baseline, no reviewer verdict); every skip is recorded",
  "integrity.title": "Test integrity",
  "integrity.failed": "The task removed or disabled tests.",
  "integrity.deleted": "Deletes a test file.",
  "integrity.skipMarker": "Adds a marker that skips or isolates tests ({{marker}}).",
  "integrity.exclusion": "Adds a test runner configuration that leaves tests out ({{keys}}).",
  "integrity.fewerTests":
    "`{{command}}` runs fewer tests than before the task ({{now}}; before: {{before}}).",
  "integrity.moreSkipped":
    "`{{command}}` skips more tests than before the task ({{now}}; before: {{before}}).",
  "verify.noBash":
    "Verification runs as a bash script and no bash was found. On Windows install Git for Windows, which brings Git Bash; elsewhere put bash on PATH.",
  "verify.masks":
    "Verification hides failures in `{{command}}` (|| true, set +e). The block runs with set -euo pipefail and must fail when a check fails.",
  "verify.trivial":
    "Verification runs nothing that checks the task:\n{{command}}\nUse the project's test runner, a linter, or a check with an expected result (test -f, grep -q, curl -f).",
  "verify.notAllowed":
    "`{{command}}` is not on the list of commands bae runs when nobody confirms them ({{why}}). Add a prefix to verify.allow in .bae/config.json, or run next without --yes and --headless and confirm it yourself.",
  "regression.notAllowed":
    "The project command `{{command}}` is not on the list of commands bae runs when nobody confirms them ({{why}}). Add a prefix to verify.allow in .bae/config.json.",
  "verify.dynamic": "it runs code that is built at run time or in another shell",
  "verify.unknown": "unknown program",
  "verify.unsafeWarning": "`{{command}}` looks dangerous ({{reason}}); read it before you confirm.",
  "verify.onlyExcused":
    "Verification only runs commands that already failed before the task, so it checks nothing about this task.",
  "evidence.linesFailed":
    "The plan cites lines that do not exist, even after asking the analyst to fix them:\n{{list}}\nThe plan was not written; the rejected answer is in {{path}}. Run plan again.",
  "state.tampered":
    "Code run for this task changed bae's own state outside the repository ({{files}}); it was restored and the attempt fails.",
  "review.gitError":
    "Review failed: git could not list the task's changes (a broken index, config or filter), so the checks cannot see them.",
  "contract.memory": "Changed an agent memory file, which agents and reviewers read.",
  "contract.git": "Changed git attributes, which decide how the review sees files.",
  "contract.gitdir": "Changed the repository's git settings in .git, which the checks rely on.",
  "contract.toolchain":
    "Changed a package manager or tool setting that decides how the checks run.",
  "contract.shadow": "Added a file that would run instead of the project's own tool.",
  "contract.indexFlags":
    "Marked files as unchanged in the git index (assume-unchanged or skip-worktree), which hides them from the review: {{files}}. The flags were cleared.",
  "integrity.removedTests": "Removes tests that are not added back: {{tests}}.",
  "integrity.lostAssertions":
    "Removes {{count}} assertion line(s) from a test file without adding them back.",
  "capture.headMoved":
    "{{id}} keeps the commit recorded when it first started; commits made since then count as part of the task's changes.",
  "contract.restoreFailed":
    "Could not restore {{files}} from the capture. Fix them by hand; the next run checks them again before starting.",
  "integrity.suppression": "Adds a comment that silences a checker ({{markers}}).",
  "integrity.expectedOutput":
    "Changes a snapshot or expected-output file, which decides what the tests accept.",
  "regression.baselineTampered":
    "Running the project's commands for the baseline changed files the checks depend on ({{files}}); they were restored and nothing was launched.",
  "regression.unknown":
    "`{{command}}` exits with {{code}}, but bae could not read how many tests ran, so it cannot tell whether they passed.",
  "regression.unknownRunner":
    "bae does not recognize the test runner behind `{{command}}`, so it cannot tell whether the tests pass. Set commands.test in .bae/config.json to the runner itself, for example `npx vitest run`, `npx jest`, `pytest`, `go test -v ./...`, `cargo test` or `dotnet test`.",
  "regression.noCounts":
    "`{{command}}` gives no usable baseline: it passes but does not say how many tests ran, so the task could not be compared with it.",
  "regression.unreadSkipped": "`{{command}}` did not say how many tests ran",
  "contract.scoped":
    "The task's Scope lists this file, so the change stays: the checks run with it and the reviewer sees it.",
  "contract.weakerScripts": "It stops running what these scripts ran: {{scripts}}.",
  "contract.weakerRunner": "It adds settings that leave tests out ({{keys}}).",
  "contract.weakerToolchain":
    "It adds a setting that changes how the package manager or the test runner starts.",
  "review.noEvidence": "(none: this review was not run right after next's checks)",
  "integrity.scoped":
    "The task's Scope lists this file, so the reviewer must say why this change is correct.",
  "review.unjustified":
    "The reviewer passed the task without saying why these changes to test files are correct: {{files}}.",
  "mechanical.secretHistory":
    "A commit made during the task adds what looks like a credential ({{kind}}). It stays in the git history even if the file no longer has it, so rewrite those commits.",
  "mechanical.secretFileHistory":
    "A commit made during the task adds a secrets file. It stays in the git history even if the file is gone, so rewrite those commits.",
  "regression.notYetCreated":
    "`{{command}}` does not exist yet (its tool or script is not installed or written), so it is not compared now; once a task creates it, it must pass.",
  "regression.stillAbsent":
    "`{{command}}` still does not exist; the task that creates it must make it pass.",
  "regression.noTestsYet":
    "`{{command}}` has no tests to run yet, so there is no baseline for it; after the task it must pass and say how many tests ran.",
  "integrity.planned":
    "The task's Scope marks test files it removes, so the reviewer judges it instead.",
  "run.started":
    "Working on branch {{branch}}, created from {{from}}; each finished task is committed there.",
  "run.elsewhere":
    "This run's tasks are committed on {{branch}}, and you are on {{current}}. Switch back with `git switch {{branch}}`, or pass --new-run to start another run from here (for example after merging it).",
  "run.replanElsewhere":
    "This run's tasks are committed on {{branch}}, and you are on {{current}}. Switch back with `git switch {{branch}}` before replanning, so the new plan lands next to them.",
  "run.confirm": "Create the branch {{branch}} from {{from}} and commit each finished task there?",
  "run.declined":
    "Staying on {{current}}. Finished tasks are not committed; the next run of next asks again, and --yes creates the branch without asking.",
  "run.finished": "Every task is done on {{branch}}. Open a pull request with:",
  "run.switchFailed": "Could not create the branch {{branch}}: {{details}}",
  "run.stopped": "Nothing was changed.",
  "commit.done": "Committed {{id}} as {{sha}} on {{branch}}.",
  "commit.failed":
    "Could not commit {{id}}: {{details}}. The task is done; commit its changes yourself.",
  "commit.replan": "Committed the new plan as {{sha}} on {{branch}}.",
  "commit.plan": "Committed the plan as {{sha}} on {{branch}}.",
  "commit.planFailed": "Could not commit the plan: {{details}}. Commit its files yourself.",
  "plan.commitConfirm": "Commit the plan files now, so next starts from them?",
  "status.run": "Branch {{branch}}, created from {{from}}",
  "status.runElsewhere": "This run's tasks are committed on {{branch}}; you are on {{current}}.",
  "status.noCommits": "no commits yet",
  "option.noVerify":
    "commit without the repository's pre-commit and commit-msg hooks, like git commit --no-verify",
  "option.newRun":
    "start a new bae/ branch from the current branch instead of continuing the recorded run",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
