---
id: T-001
title: Establish a working toolchain baseline (formatter, typecheck, TS lint, CI)
status: pending
phase: 1
depends_on: []
size: M
risk: medium
---
## Goal
`npm ci`, lint, format check, typecheck, tests and build all run and pass locally and in CI, so every later task has a real quality gate. This task creates the missing formatter (Prettier) and fixes the declared-but-broken typecheck, lint, build and CI.

## Context
- Owner agent: `toolchain`.
- Read first: AGENTS.md, docs/plan/03-decisions/ADR-001-toolchain-baseline.md, and docs/plan/02-architecture.md ("Baseline defects" D1–D6).
- Evidence: package.json:4-19, tsconfig.json:1, eslint.config.js:1, .github/workflows/ci.yml:1-7, package-lock.json:1, .gitignore:1-4.

Gotchas:
- `.gitignore` has uncommitted local changes (the `.bae/` lines). Append to it; never rewrite or drop lines.
- `main` and `bin` point to `dist/index.js` and `dist/cli.js` (package.json:5-6). The build must emit exactly there (`rootDir: src`).
- Source uses ESM `.js` import specifiers (src/index.ts:2), so use `NodeNext`.
- Importing `dist/index.js` starts a server on port 3000. For load checks, import `dist/routes/users.js` instead.
- Runtime behavior of `src/*.ts` must not change. Only formatting or type-only edits are allowed.
- `tsc` doesn't clean `dist/`. If a stale `dist/` exists locally, tell the user rather than deleting it with `rm -rf`.

## Scope
- **In:**
  - package.json, package-lock.json, tsconfig.json, tsconfig.build.json (new)
  - eslint.config.js, .prettierrc.json (new), .prettierignore (new)
  - .gitignore, .nvmrc (new), .github/workflows/ci.yml
  - formatting-only changes in src/ and test/
- **Out:** app refactor (T-002), new tests, new source files, src/cli.ts FIXME, src/index.ts port TODO.

## Steps
1. Append `node_modules/` and `coverage/` to `.gitignore`.
2. Create `.nvmrc` containing `22`. In package.json, add `"engines": { "node": ">=22" }` and set these scripts:
   - `"build": "tsc -p tsconfig.build.json"`
   - `"typecheck": "tsc --noEmit"`
   - `"lint": "eslint ."`
   - `"format": "prettier --write ."`
   - `"format:check": "prettier --check ."`
   - Keep `"test": "vitest run"`.
3. Run `npm install -D @types/node @types/express@^5 prettier@^3 typescript-eslint @eslint/js globals eslint-config-prettier`. This also regenerates package-lock.json.
4. `tsconfig.json`: `{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "esModuleInterop": true, "skipLibCheck": true, "forceConsistentCasingInFileNames": true, "noEmit": true }, "include": ["src", "test"] }`.
   `tsconfig.build.json`: `{ "extends": "./tsconfig.json", "compilerOptions": { "noEmit": false, "rootDir": "src", "outDir": "dist" }, "include": ["src"] }`.
5. `eslint.config.js`: ignores (`dist/`, `coverage/`, `generated/`, `.bae/`, `node_modules/`), then `@eslint/js` recommended, typescript-eslint recommended, `languageOptions.globals = globals.node`, then `eslint-config-prettier` last. Use `defineConfig` from `eslint/config` if the installed ESLint exports it, else `tseslint.config`.
6. `.prettierrc.json`: `{ "semi": true, "singleQuote": false }`. `.prettierignore`: `dist`, `coverage`, `generated`, `.bae`, `node_modules`, `package-lock.json`, `*.md`.
7. Run `npm run format`. Confirm with `git diff src test` that the changes are whitespace or format only.
8. Rewrite `.github/workflows/ci.yml`:
   - `on: [push, pull_request]`
   - job `test` on `ubuntu-latest` with steps: `actions/checkout@v5`, `actions/setup-node@v5` (`node-version-file: .nvmrc`, `cache: npm`), then `npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`.
9. Run the Verification block. Fix type or lint errors with minimal, non-behavioral edits. Record anything unexpected under Risks and notes.

## Acceptance criteria
- [ ] `npm ci` succeeds from the committed lockfile.
- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` and `npm run build` each exit 0.
- [ ] ESLint actually lints `.ts` files: linting them explicitly with `--max-warnings=0` produces no "no matching configuration" warning.
- [ ] The build emits `dist/index.js`, `dist/cli.js` and `dist/routes/users.js` as loadable ESM. `dist/test` does not exist.
- [ ] The CI workflow checks out the code, sets up Node from `.nvmrc`, runs `npm ci` and all five gates, and triggers on push and pull_request.
- [ ] `.gitignore` contains `node_modules/` and still contains every pre-existing line.
- [ ] The diff under `src/` and `test/` is formatting or type-only. No behavior change.

## Verification
```sh
npm ci
npm run lint
npx eslint --max-warnings=0 src/index.ts src/routes/users.ts
npm run format:check
npm run typecheck
npm test
npm run build
test -f dist/index.js
test -f dist/cli.js
test ! -e dist/test
node --input-type=module -e "const m = await import('./dist/routes/users.js'); if (typeof m.users !== 'function') process.exit(1);"
grep -q "actions/checkout" .github/workflows/ci.yml
grep -q "npm ci" .github/workflows/ci.yml
grep -q "pull_request" .github/workflows/ci.yml
grep -q "node_modules" .gitignore
grep -q ".bae/runs/" .gitignore
```
Every command exits 0. The `node -e` line proves the emitted JS loads as ESM (defect D2). `test ! -e dist/test` proves tests aren't compiled into the build (D3).

## Risks and notes
- The defects were inferred without running anything. Expect surprises (for example, the `@types/express` v5 API or ESLint config helper differences). Fix them here and note them.
- `npm install` needs network access.
- The first Prettier run may touch every file; keep that change separate from logic.
