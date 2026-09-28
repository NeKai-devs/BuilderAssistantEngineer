# Contributing

Thanks for helping. This document covers how to set up the project, the rules the code follows and how releases happen.

## Setup

```sh
git clone https://github.com/NeKai-devs/BuilderAssistantEngineer.git
cd BuilderAssistantEngineer
npm ci
npm run dev -- --help
```

Node.js 22 or newer is recommended for development. The CLI itself supports Node.js 20.12+, and CI runs on 20 and 24 across Linux, macOS and Windows.

| Script | What it does |
| --- | --- |
| `npm run dev -- <command>` | Runs the CLI from source with `tsx` |
| `npm run lint` | Biome lint and format check |
| `npm run format` | Applies Biome fixes and formatting |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |
| `npm run build` | Compiles to `dist/` and copies the prompts |

Before opening a pull request, run `npm run lint && npm run typecheck && npm test && npm run build`.

## Rules

- TypeScript, ESM, one npm package. Keep it cross-platform: build paths with `node:path`, use `/` only for repository-relative paths, and never assume a POSIX shell outside `runShell`.
- No comments in the code. Prefer small functions with clear names.
- Few dependencies, and only popular, maintained ones. Runtime dependencies must support Node.js 20 (this is why `commander`, `execa` and `vitest` are pinned below their latest majors).
- Everything the user sees goes through `t()` in `src/i18n`. Add each key to both `en.ts` and `es.ts`; the types fail otherwise.
- Prompts live in `src/prompts/*.md` with `{{variables}}`. The analyst prompt defines the output contract that `src/plan/parser.ts` enforces, so change them together.
- Tests never call a real AI. Use the fakes in `test/fakes.ts` (scripted prompter and backends) and the repository fixtures in `test/fixtures/repos`. Build secret-looking strings at runtime so they are never committed.

### Adding dependencies

npm 10 (bundled with Node.js 22) can crash with `Cannot read properties of null (reading 'edgesOut')` while resolving vitest's optional peers. Use npm 11 to change dependencies:

```sh
npx -y npm@11 install <package>
```

The resulting lockfile installs fine with `npm ci` on npm 10.

## Evaluating prompt changes

`npm run eval` runs `init` and `plan` for real on every repository in `test/fixtures/repos` that has a brief in `scripts/eval/briefs/<fixture>.md`, and saves the results under `eval/<label>/` (or `eval/<date>/` without a label):

```sh
npm run eval -- --backend claude --lang en --label my-change
npm run eval -- --backend opencode --only go-service,node-app --label shorter-roadmap
```

Each fixture gets `prompt.md` (the exact prompt), `cli-output.txt`, `output/` (every generated file) and `meta.json`. The run gets a `summary.md` with one row per fixture and a total row:

| Metric | Meaning |
| --- | --- |
| Tasks | task files written |
| Tasks with verification | tasks whose Verification has at least one command in a `sh` block |
| file:line refs valid | backticked `path:line` citations whose file exists and has that line |
| Cited paths that exist | backticked path citations that exist after the plan (future files count as missing) |
| Existence claims verified | citations the evidence check validates (architecture, ADRs, task Context; `(new)` paths excluded) that exist |
| Questions (blocking) | questions returned by the analyst |
| Continuations, format retries | how often the answer was cut off or malformed |
| Local repairs | format slips fixed without asking the model again |
| Evidence retries, unverified after retry | how often cited paths had to be fixed, and how many stayed unverified |
| Commands | project commands saved to `.bae/config.json` (out of test, lint, typecheck, build) |
| tests: required, Empty Log | tasks that require tests, and tasks that end with an empty `## Log` |
| Minutes, cost | wall time, and cost when the backend reports it (claude) |

The header records the backend, the models the backend reported, the `analyst.md` hash and the tool commit. Options: `--backend`, `--lang`, `--targets`, `--only`, `--label` and `--out`.

Only `eval/baseline/` is committed; other runs stay local (see `.gitignore`). To judge a change to `src/prompts/analyst.md`, run the eval with the same backend and compare its `summary.md` with `eval/baseline/summary.md`, or diff the outputs with `git diff --no-index eval/baseline eval/<label>`. The runs call a real AI, so they cost whatever the chosen backend costs.

## Project layout

```text
src/cli.ts            commander wiring, global flags, exit codes
src/commands/         init, plan, next, status, replan, review
src/gates/            the next gate: verification, regression, handoff note, review
src/digest/           repository digest: walk, manifests, baseline, redaction, budget
src/backends/         claude, opencode, codex, gemini, api, manual
src/interview/        base questions and the adaptive round
src/analyst/          analyst prompt variables and the one-time format retry
src/plan/             plan parser, local repair, evidence check, questions, prior plan
src/artifacts/        managed merge, lessons block, diffs, confirmation and writes
src/tasks/            task files, selection, status, verification, handoff, attempts, metrics, lessons
src/review/           task diff, mechanical checks and reviewer
src/prompts/          analyst, task, review, retry, fix-format, fix-paths, continue and lesson prompts
scripts/eval/         eval runner, metrics and fixture briefs
test/                 unit and end-to-end tests
```

## Commits and releases

Use [Conventional Commits](https://www.conventionalcommits.org): `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`. Pull request titles are checked, because squash merges use them as the commit message.

### Releases

Releases go through release-please and npm trusted publishing. There is no npm token anywhere: the `publish` job in `.github/workflows/release.yml` gets a short-lived OIDC token from GitHub (`id-token: write`, `contents: read`), and npm exchanges it for a publish credential. The trusted publisher on npmjs.com is `NeKai-devs / BuilderAssistantEngineer / release.yml`, with no environment, allowed to stage.

1. Every push to `main` updates the release pull request that release-please keeps open, with the next version and the changelog.
2. Merging that pull request creates the tag and the GitHub release, then the `publish` job builds the tag and stages it on npm with provenance. The job log ends with `staged with id <stage-id>`.
3. A maintainer approves it with 2FA. npm 10 has no `stage` command, so run a current npm through `npx`:

   ```bash
   npx -y npm@latest stage list builder-assistant-engineer
   npx -y npm@latest stage approve <stage-id>
   ```

   The package page on npmjs.com can approve it too. Then `npx builder-assistant-engineer@latest --version`, run from an empty folder, prints the new version.

To recover when the tag and the GitHub release exist but npm does not have the version, run the workflow by hand for that tag:

```bash
gh workflow run release.yml -f tag=vX.Y.Z
```

It checks out the tag, checks that `package.json` has that version and that npm does not have it yet, and stages it; continue with step 3. npm runs with verbose logging, and a failed run uploads npm's logs as the `npm-logs` artifact.
