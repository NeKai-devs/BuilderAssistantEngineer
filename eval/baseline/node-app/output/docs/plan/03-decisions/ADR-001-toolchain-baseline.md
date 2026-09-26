# ADR-001: Fix the toolchain baseline before feature work

- Status: Accepted
- Date: 2026-09-26

## Context
The repo declares TypeScript, ESLint, Vitest and CI, but none of them works as a gate (docs/plan/02-architecture.md, D1–D6):
- tsconfig.json:1 has no module settings.
- There are no `@types` (package.json:15-19).
- The ESLint config is empty (eslint.config.js:1).
- CI never checks out the code (.github/workflows/ci.yml:6-7).
- The lockfile is a stub (package-lock.json:1).
- There is no formatter.

Feature work without a real gate would pile up unverified changes.

## Decision
- **TypeScript:**
  - `tsconfig.json` is the typecheck config: `target ES2022`, `module/moduleResolution NodeNext`, `strict`, `esModuleInterop`, `skipLibCheck`, `noEmit`, including `src` and `test`.
  - `tsconfig.build.json` extends it with `noEmit: false`, `rootDir: src`, `outDir: dist`, including `src` only. This keeps `dist/index.js` and `dist/cli.js` (package.json:5-6).
  - Add `@types/node` and `@types/express@^5`.
- **Lint:** ESLint 9 flat config with `@eslint/js` recommended, `typescript-eslint` recommended, `globals.node`, and `eslint-config-prettier` last.
- **Format:** Prettier 3 for code and config. Markdown is excluded so agent-edited plan files don't churn. The settings match the current style (double quotes, semicolons).
- **Scripts:** `build` = `tsc -p tsconfig.build.json`, plus `typecheck`, `format`, `format:check`, and later `start` and `smoke`.
- **Runtime:** Node >= 22 via `engines` and `.nvmrc`.
- **CI:** on push and pull_request: checkout, setup-node (from `.nvmrc`, npm cache), `npm ci`, lint, format:check, typecheck, test, build.
- Regenerate `package-lock.json`. Ignore `node_modules/` and `coverage/`.

## Alternatives
- **Biome (lint + format in one tool):** fewer dependencies, but it replaces the ESLint 9 the repo already declares. Rejected to respect existing tooling.
- **Drop `"type": "module"` and emit CommonJS:** the source already uses ESM `.js` specifiers (src/index.ts:2), so this is a regression. Rejected.
- **Run TS directly with tsx/ts-node:** `main` and `bin` point to built output, so the build is the contract. Rejected.

## Consequences
- A one-time formatting diff.
- More devDependencies.
- CI becomes a real gate, and later tasks rely on it.
- If more breakages appear during T-001, they are fixed there and recorded in the task notes.
