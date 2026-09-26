---
id: T-001
title: Add the quality gate script, staticcheck lint and GitHub Actions CI
status: pending
phase: 1
depends_on: []
size: S
risk: low
---
## Goal
One command, `sh scripts/check.sh`, runs every quality gate: gofmt, go vet, staticcheck and the tests. It runs the same way locally and in GitHub Actions. This fills the two baseline gaps, lint and CI, which are absent today: the repo holds only `go.mod`, `main.go`, `internal/handler/*` and `.gitignore`.

## Context
- Read `AGENTS.md` and `docs/plan/03-decisions/ADR-004-quality-gate-and-ci.md`.
- `go.mod:5` requires gin v1.10.0, but nothing imports it and there is no `go.sum`.
  - Do **not** run `go mod tidy` in this task. It would remove the gin requirement that T-002 needs.
  - If `go vet ./...` fails with `missing go.sum entry`, run `go mod download github.com/gin-gonic/gin` and keep the `go.sum` it creates.
- `internal/handler/handler_test.go:5` is a trivial test. Leave it; T-002 replaces it.
- No git remote exists (`.git/config`). GitHub Actions is assumption A-5.

## Scope
- In:
  - `scripts/check.sh` (new)
  - `.github/workflows/ci.yml` (new)
  - `.gitignore` (add `bin/`)
  - `go.sum` (only if needed, see Context)
  - `docs/plan/03-decisions/ADR-004-quality-gate-and-ci.md` (write the chosen staticcheck version in Consequences)
- Out:
  - any `.go` file
  - `go mod tidy`
  - `go mod tidy -diff` in the script (T-002 adds it)
  - Dockerfile, release pipelines

## Steps
1. Create `scripts/check.sh`:
   - POSIX `sh`, with `#!/bin/sh` and `set -eu`, and a one-line comment saying it is the single quality gate for local runs and CI.
   - Set `STATICCHECK_VERSION="2025.1.1"` once, at the top.
   - Run these in order:
     - gofmt check: save `gofmt -l .`; if it is not empty, print "gofmt needed:" and the files, then `exit 1`;
     - `go vet ./...`;
     - `go run "honnef.co/go/tools/cmd/staticcheck@${STATICCHECK_VERSION}" ./...`;
     - `go test -race -count=1 ./...` when `RACE=1`, otherwise `go test -count=1 ./...`.
   - Make it executable (`chmod +x scripts/check.sh`).
2. Run `sh scripts/check.sh`. If staticcheck fails to build, or reports an unsupported Go version under the installed `go version`, raise `STATICCHECK_VERSION` to the newest release listed at https://staticcheck.dev/changes/ that works. Write the final version in ADR-004's Consequences.
3. Create `.github/workflows/ci.yml`:
   ```yaml
   name: ci
   on:
     push:
       branches: [main]
     pull_request:
   permissions:
     contents: read
   jobs:
     check:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-go@v5
           with:
             go-version: stable
         - run: RACE=1 sh scripts/check.sh
   ```
4. Check the workflow with actionlint (see Verification).
5. Add a line `bin/` to `.gitignore`, keeping the two existing lines.

## Acceptance criteria
- [ ] `sh scripts/check.sh` exits 0 on the current tree.
- [ ] The script exits 1 and prints the file names when `gofmt -l .` is not empty (check by reading the script).
- [ ] `STATICCHECK_VERSION=` is assigned exactly once, in `scripts/check.sh`, and ADR-004 records the chosen version.
- [ ] `.github/workflows/ci.yml` runs `RACE=1 sh scripts/check.sh`, does not call staticcheck or go test itself, has `permissions: contents: read`, and passes actionlint.
- [ ] `go.mod` still contains `require github.com/gin-gonic/gin v1.10.0`.
- [ ] `.gitignore` contains a `bin/` line, and its original two lines are unchanged.
- [ ] No `.go` file changed.

## Verification
```sh
sh scripts/check.sh
test "$(grep -c '^STATICCHECK_VERSION=' scripts/check.sh)" = 1
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/ci.yml
grep -q 'RACE=1 sh scripts/check.sh' .github/workflows/ci.yml
! grep -q 'staticcheck' .github/workflows/ci.yml
grep -q 'contents: read' .github/workflows/ci.yml
grep -q 'github.com/gin-gonic/gin v1.10.0' go.mod
grep -qx 'bin/' .gitignore
grep -qx '.bae/runs/' .gitignore
```
Every command exits 0. The first run of `go run ...@version` downloads the tool, which needs network access.

## Risks and notes
- staticcheck and the Go toolchain have to be compatible; step 2 handles it. Record the chosen version.
- If the user picks a different CI provider (Q3), replace only the workflow file. `scripts/check.sh` stays.
- `-race` is not checked locally here, because it needs a C compiler. CI covers it.
