# Changelog

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
