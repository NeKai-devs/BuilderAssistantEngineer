# Changelog

## [0.4.1](https://github.com/NeKai-devs/BuilderAssistantEngineer/compare/v0.4.0...v0.4.1) (2026-09-30)


### Bug Fixes

* 0.4.1 contract false positive, Spanish remnants and commit casing ([9b9dde6](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/9b9dde654f70c2de31c4fe04a1b94954e0725c31))
* **commit:** lowercase an accented first letter in a task's commit subject ([10b8454](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/10b8454e9e1e4458bd009d922cd85fcf71ef696d))
* **contract:** stop guarding build output and ignored files the checks run ([4b91240](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/4b9124049985e1e97933c29d52c658810b306a90))
* **i18n:** show confirmations, stuck tasks and secret kinds in the chosen language ([03cc637](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/03cc6373a7bbe684114b2a8907732d02051ea5bb))

## [0.4.0](https://github.com/NeKai-devs/BuilderAssistantEngineer/compare/v0.3.3...v0.4.0) (2026-09-29)


### Features

* 0.4.0 progress, cost, one path and safe repository state ([0f1708f](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/0f1708ffd2cf6e1d59d4a0f44c97500443c7241c))
* **progress:** show what the AI is doing and what each command cost ([16c1201](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/16c120165f678d811c188bef956d52202a871599))


### Bug Fixes

* **analyst:** let the plan read the system prompt that init's questions cached ([c3d6343](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/c3d6343e16a4d5621848aba241d46229009c3be5))
* **checks:** read curl's arguments before deciding where it sends data ([bff0fc0](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/bff0fc0891bd67275128cce19827bcee08249eba))
* **checks:** refuse inline code and uploads to other hosts when nobody confirms ([5c05be8](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/5c05be8fcd0e8aaca0ffa15fbdcf3caeb0a2fef1))
* **cli:** exit 130 when a spinner is interrupted, and 1 when next has nothing to run ([8467318](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/8467318f0e4a34b181436ff9541e6c164c32c52a))
* **init:** name the next step with the command the user typed ([b59331e](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/b59331ed007b9d350cf092097b31db44f187e6b1))
* **messages:** name every command the user must run as bae next, never /next ([583af70](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/583af70fadf9331b77f8fdcd9a3ffc8e08acfda8))
* **next:** do not start a task over uncommitted changes without asking ([12fe33d](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/12fe33d61039a19f26ffb421af014256bae45e61))
* **next:** warn when the plan itself was never committed ([3b85cc3](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/3b85cc3b92d5e7fdd1e362b49107609d4cb841ed))
* **plan:** name the next step as a bae command, never /next ([bfd4f3b](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/bfd4f3b260a49572a4011b4759173b3d7442b18b))
* **process:** stop a headless agent's whole process tree, and clean scratch files on Ctrl-C ([b0c98a9](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/b0c98a971123903697a2d9891a84ac12c57eadac))
* **progress:** keep the spinner on one terminal row ([a471296](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/a4712960a18f1a0c599e38044c3b5a77dd8ec618))
* **progress:** say the AI is writing while text arrives, keep converted descriptions on one line ([3ed4ba1](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/3ed4ba12a7173feedc5f9a53c1993399f9615915))
* **replan:** reopen a blocked task that the new plan rewrites ([ff04202](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/ff042027b97118d47d6cc2590ba302546bf518b9))
* **repo:** lock, subdirectories, empty repositories, timeouts and setup warnings ([a2adf4a](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/a2adf4accb3c8f36fd1afdee102d0e256cebc073))


### Performance Improvements

* **analyst:** keep the instructions and digest in a cached system prompt ([78a9cd3](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/78a9cd36e0b3914026435032eb1dc2f8bea5ad60))
* **plan:** stop asking the AI for files bae can write itself ([75e22b6](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/75e22b62da938acc7e041acf8c9eb2a1085f6d5f))

## [0.3.3](https://github.com/NeKai-devs/BuilderAssistantEngineer/compare/v0.3.2...v0.3.3) (2026-09-29)


### Bug Fixes

* 0.3.3 correctness and safety from the 0.3.2 audit ([9d031bd](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/9d031bd8f6d060af51ce02e96b8bcd52778a8a14))
* **next:** check the agent CLI through the process runner ([8aef627](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/8aef62732be3d18788f928a00ca8998e267115fb))
* **next:** never mark done an agent that did not work ([cad1c1b](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/cad1c1bb692e49aac89e3a9b60c888b9e8b71de9))
* **plan:** write plans that next can run unattended ([a5a888b](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/a5a888b8d135c921868802f8baf0703d6fdaedbe))
* **security:** ask before a repository's commands first run, and keep secrets out ([1acd5a0](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/1acd5a0c6c7b177b784ba69a628ded70d2968769))
* **security:** re-ask for new commands, list what the agent loads, treat the repo as data ([3c2c8a2](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/3c2c8a292da9fc8dafee6fd521455f58880ce18b))

## [0.3.2](https://github.com/NeKai-devs/BuilderAssistantEngineer/compare/v0.3.1...v0.3.2) (2026-09-29)


### Bug Fixes

* **plan:** a first plan that never ends in nothing ([99fb65e](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/99fb65e0777ace9b24f38407a3e7f14b20c6aaea))
* **plan:** never throw a plan away over a Verification block ([46b86ae](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/46b86aeeca20d390462a3eb51790f83e170d944a))
* **verify:** accept a server started in the background ([3a5dfda](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/3a5dfda10fd272c8a60cfd950469b5d55f31962a))
* **verify:** read quoted heredocs, and let kill stop a saved job pid ([bb86b73](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/bb86b735cfc61c233cd7141b9e76163039f49ff4))

## [0.3.1](https://github.com/NeKai-devs/BuilderAssistantEngineer/compare/v0.3.0...v0.3.1) (2026-09-28)


### Bug Fixes

* first-run friction found by following the quickstart ([117b389](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/117b3898c770cf805a58a94b7249db34edad0921))
* **next:** allow the helpers agents chain onto commands, and name the real cause ([89b4d27](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/89b4d270141b81703c6ca46763bc76fb6699cbc7))
* **next:** headless runs that work on first use ([f87c630](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/f87c630934533ce0d184eeff0830bd22249cc955))
* **next:** let headless agents run the task's commands, and stop retrying what cannot change ([adb191c](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/adb191cdbe0a6668b3b9ee634c5c09963ad89b80))
* **next:** say how to retry a blocked task, and warn about headless permissions ([f7ced76](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/f7ced76a332762aa934156a055e9e7cb578c1fdd))
* **next:** say when a baseline program is missing, and stop calling it harmless ([78ef156](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/78ef15610d8cf7979c1423b7e711a02100f29363))
* **next:** tell a headless agent which commands it may run ([7aa79cc](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/7aa79cc16755b63bec254faaed80d7b5bdc106b0))
* **plan:** offer to commit the plan when it is written ([235ff9f](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/235ff9f813eff81e202af418b90c1738c62ef75a))
* **review:** leave installed dependencies out of the task's changes ([0b67c73](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/0b67c73123dc65d05061eba704de78e462207bf6))

## [0.3.0](https://github.com/NeKai-devs/BuilderAssistantEngineer/compare/v0.2.0...v0.3.0) (2026-09-28)


### Features

* **analyst:** keep acceptance criteria within the task's Scope ([9121570](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/912157051a8a8d933d74c5f33dedc08fce73f6f8))
* conventional task commits on a bae/ run branch; criteria within Scope ([bec66a7](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/bec66a7b1819af00bf95b238b1c0571e69d36612))
* **next:** commit each finished task on a bae/ run branch ([5529921](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/55299210af4fa7c3aac94a8298429c8c097be4a9))
* **next:** conventional task commits that run the repo's hooks ([6d3f512](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/6d3f512ae8cf0eef4553e950e1c8ef3d9d51663c))


### Bug Fixes

* **next:** keep acronyms at the start of task commit subjects ([0251d3b](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/0251d3bfa43d2bfae5c0b4499c3d79a18cdc705b))
* **next:** leave git's line-ending warnings out of commit failures ([4ada326](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/4ada326a0af4e0a0402a8e30b905603a31b21688))

## [0.2.0](https://github.com/NeKai-devs/BuilderAssistantEngineer/compare/v0.1.0...v0.2.0) (2026-09-28)


### Features

* **eval:** measure the new gates in the eval summary ([91e56df](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/91e56dfab6a909d7e19358c5b579f59f1816208a))
* gates the agent cannot rewrite (0.2.0 and 0.3.0) ([ce9669d](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/ce9669daf07565173934c1a8f6f0afd5051b81b5))
* **gates:** block tests that were removed, skipped or excluded ([3dfa74c](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/3dfa74ceb3f38dab8d3cec52c9cbbccfbf6774ab))
* **gates:** capture the checks' inputs outside the repo before the agent runs ([b89583a](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/b89583ac8e87d44435b54e012650ab66b6228236))
* **gates:** fail closed when a check cannot run or cannot be compared ([40b0c24](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/40b0c247171f9d566fa04ccb77b25df83bbe2fe3))
* **gates:** make cited lines a real gate and widen secret detection ([6b107d3](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/6b107d32627408f1a8cdf7ec3f4cc303418bdedd))
* **gates:** pass tasks with no diff and make the handoff note a warning ([74087be](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/74087be2aa4759e15d365e668052c754b4759e2f))
* **gates:** read test verdicts from the runner's own report ([e1ffdfc](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/e1ffdfc39ff5e46cc0a0f6f645eb68f50e88baa3))
* **next:** block tasks that turn the project's lint or test red ([5182506](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/5182506fbaaca97483f074e4bee01b09678ac779))
* **next:** require a handoff note in each task's Log and share recent ones ([0829e61](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/0829e613ae47cc89ef682afbf49257177120c298))
* **next:** turn repeated failures into rules in AGENTS.md ([5fe2777](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/5fe2777231f7763b6aa8094e578a007a49eaa8a4))
* **plan:** ask blocking questions on the spot and keep every question ([1db3192](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/1db3192a8f12f4798f2161d113936c9e0aff1f12))
* **plan:** check that cited paths exist before writing the plan ([a75c672](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/a75c67265d6143b1048a346f059aaccf2828722c))
* **plan:** repair known format slips locally before asking the model ([2d87a5e](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/2d87a5e0527a093663ac8c19b8c6ee6e39f35e19))
* **review:** run mechanical checks on the task diff before the AI reviewer ([b3fbe86](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/b3fbe86170ea578debb582c552503412a3e4a47e))
* **status:** show local metrics from the recorded attempts ([cd7db3c](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/cd7db3c01202438e2ab09159e610d793d9815903))
* **verify:** run Verification as one strict bash script ([2a0ce1f](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/2a0ce1f4ad6eab212ee382f58f59935a50fca3fb))


### Bug Fixes

* **artifacts:** keep one Lessons learned heading in AGENTS.md ([56b3d30](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/56b3d302fd72932bee36148051ee8e2e3c125c77))
* **backends:** keep the whole answer when claude splits it into messages ([224ee13](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/224ee137e674e9080d636da6fd04e529c63bd47b))
* **gates:** close the critical findings of the second adversarial review ([5d91a3c](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/5d91a3cf69cc98ac49854a41690347f837d03a57))
* **gates:** close the high findings of the second adversarial review ([4bd3b45](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/4bd3b4564c88e17727fad852a1b832de56dfba56))
* **gates:** close the high findings of the third adversarial review ([630ccea](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/630ccea9435fa2e322deda6387092e2a7b70a969))
* **gates:** close the medium and low findings of the second review ([b973342](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/b9733427e8511498e637ed8a32a21b4b0986fe80))
* **gates:** let correct work through the contract and the reviewer ([4289bbf](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/4289bbf920cb72cf64da0e5accf388e549563a51))
* **gates:** read node --test from JUnit and count assertions per test file ([9d6296e](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/9d6296ee5b7a9d1385440fb916a13fcf1d46d5ec))
* **gates:** stop blocking correct tooling tasks and repository scripts ([b0ff09d](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/b0ff09d683a5b84727a0b11a086c355b6fe80f1d))
* **integrity:** let the plan authorize removing tests ([0149bb2](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/0149bb236d4f958f88dc4730836835c80fa46d29))
* **integrity:** tell a planned test refactor from a shortcut ([52e32c6](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/52e32c666421cadd0a94da92db319a9b712c51f3))
* **next:** close gaps found in review of the handoff and regression gates ([e70015a](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/e70015a5e5f021f7cac74882856fed7951bd7e6e))
* **next:** reset the attempt budget of a task blocked by agent errors ([ba18701](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/ba1870116f40d7d55e98a851672776788a9cf37e))
* **next:** stop a suite that was already red from blocking Verification ([1a04f9d](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/1a04f9d0e12031b9a3944d3b2fe273087286934f))
* **plan:** keep the plan when the request to fix cited paths fails ([65732a9](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/65732a9fc65b022fd554c05a70a893274a8122ff))
* **regression:** read what ran and let untouched failures be ([dbfb14d](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/dbfb14d41b1a0e885f051134be06a7665959a1d9))
* **review:** find secrets where they stay and stop flagging look-alikes ([2b9742b](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/2b9742b40d908848055963d13ec0c65c06e85cc3))
* **review:** ignore changes that were already there when the task started ([1f939d4](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/1f939d42574823a83fda665ebde368ec627388f1))
* **review:** leave caches a tool ignores during the task out of the review ([fbc8e95](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/fbc8e95bb2b015324c79a3bdc0b033d1351020be))
* **review:** only a stated verdict contradicts the reviewer's JSON ([8b79f7e](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/8b79f7efbfb56c0ca1eb72fc70b512db1e9220a0))
* **review:** review code that a rule added during the task ignores ([2e4f5ea](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/2e4f5ea0972db230ca3fa1f6ab8f5008f2392adb))
* **review:** review code that a rule added during the task ignores ([10d135c](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/10d135cbd0abe87081ce9d69c0b1b9b0cba71663))
* **verify:** run the block as written and stop refusing correct blocks ([d49d6dd](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/d49d6ddcfb428af7c90e1695f2513f34d812a2f7))

## 0.1.0 (2026-09-26)


### Features

* **backends:** add claude, opencode, codex, gemini, api and manual backends ([c24cca9](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/c24cca939355aa04f6b745ab5b6e0f393b11fde2))
* **digest:** build a redacted, budgeted repository digest ([3da7571](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/3da75712523f1963a591f952ea3f97649364185f))
* **eval:** add comparable metrics and a committed baseline folder ([e68134b](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/e68134bc1ba5f72c54a0601661f4308917fb7bbc))
* **eval:** add npm run eval to compare plans across prompt versions ([93eb138](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/93eb1389d5f0330dcc7386ad131c4161288954c6))
* **init:** add init command with base and adaptive interview ([30d609e](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/30d609e0b0bb7c7d6d37f05318016af1d8d722fc))
* **next:** add next, status, replan and review with verification and review gates ([7f7f141](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/7f7f1414fb746c78e7efc461a7dca57927377b95))
* **plan:** continue answers cut off by the model's output limit ([bf5460d](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/bf5460d8473888ebbffdadf16ac412dba2a5b407))
* **plan:** generate plan artifacts with a strict parser and safe merge ([9259f83](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/9259f83435f5cc0edbc7347b41aac2d132293b59))
* **plan:** keep the format errors that triggered a retry in plan-report.json ([6885e2e](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/6885e2ec2645980fdf03fcbede91c77dad344600))
* **plan:** record model, cost, continuations and retries in plan-report.json ([ffd799f](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/ffd799f5a0501c185e5a58cd7e4695aa1e744a8f))


### Bug Fixes

* **eval:** name temp repos after the fixture and save cli-output.txt ([cccffdb](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/cccffdbd0386e14810e9c251e5f60551221fdf86))
* **process:** detect missing executables before spawning ([db73fb3](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/db73fb391506f957848934693130dd76a43cf591))
* run child processes with PWD set to their cwd and anchor plan markers ([521e98c](https://github.com/NeKai-devs/BuilderAssistantEngineer/commit/521e98cd39ec7b7db4defcd96e6164d72abb384b))
