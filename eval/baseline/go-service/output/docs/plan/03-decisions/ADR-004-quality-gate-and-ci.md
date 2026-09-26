# ADR-004: Quality gate script and CI

- Status: Accepted
- Date: 2026-09-26

## Context
Baseline: lint and CI are absent; tests, formatting (gofmt) and type checking (the compiler) are present. There is no git remote (`.git/config`). Agents need one command that says whether the repo is healthy, and CI must run exactly the same thing.

## Decision
- `scripts/check.sh` (POSIX `sh`, `set -eu`) is the single quality gate. In order:
  1. gofmt check: fail and list the files if `gofmt -l .` prints anything;
  2. `go mod tidy -diff`: added in T-002, once gin is imported;
  3. `go vet ./...`;
  4. `go run honnef.co/go/tools/cmd/staticcheck@$STATICCHECK_VERSION ./...`, with the version set once at the top of the script;
  5. `go test -count=1 ./...`, plus `-race` when `RACE=1`.
- CI: GitHub Actions `.github/workflows/ci.yml`:
  - triggers on push to `main` and on pull requests;
  - `permissions: contents: read`;
  - `actions/checkout@v4`, then `actions/setup-go@v5` with `go-version: stable`;
  - one step: `RACE=1 sh scripts/check.sh`.
- The workflow is validated with `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7`.

## Alternatives considered
- **golangci-lint.** Rejected for now: a separate binary with its own versioning and config, which is overkill for about 10 files. Easy to adopt later by replacing step 4.
- **A Makefile.** Rejected: adds `make` as a requirement and has tab pitfalls. `sh` is always there.
- **CI on `go-version-file: go.mod` (Go 1.23).** Rejected: 1.23 no longer gets upstream support, and recent staticcheck releases may need a newer Go to build. `go vet` catches standard library APIs newer than the `go 1.23` directive.
- **Only `go vet`.** Rejected: staticcheck catches real bugs that vet misses, and it costs one line.

## Consequences
- `go run pkg@version` fetches tools through the module proxy, so network access is needed (A-7). They are cached after the first run.
- The staticcheck version must move with the Go toolchain. T-001 picks a version that works and writes it down below.
- `-race` needs cgo and a C compiler. It always runs in CI and is optional locally.
- Chosen staticcheck version: _(T-001 fills this in)_.
