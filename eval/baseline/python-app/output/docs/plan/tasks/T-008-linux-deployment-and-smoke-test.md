---
id: T-008
title: Add Linux deployment artifacts, operations guide and live smoke test
status: pending
phase: 3
depends_on: [T-004, T-005, T-006, T-007]
size: M
risk: medium
---
## Goal
When this is done, an operator can install and run the service on a Linux server with Python 3.12 by following one document. A script proves the full CRUD flow, and persistence across a restart, against a real uvicorn process, both locally and in CI.

## Context
- Suggested agent: platform.
- Read first: AGENTS.md; ADR-005; `docs/plan/01-prd.md` (non-functional requirements); `README.md`; `.github/workflows/ci.yml`; `pyproject.toml`; `app/config.py` for the environment variable names.
- **Deployment model:** a venv plus systemd is an assumption (open question 2). Keep the artifacts generic and documented.
- **Smoke script safety:**
  - Use `sys.executable -m uvicorn`.
  - Pick a free port by binding a socket to port 0.
  - Put the DB in `tempfile.TemporaryDirectory()`.
  - Always terminate the child process in `finally`, with `terminate()` and then `kill()` if it hasn't exited after 10 s.
  - Poll `/health` with a 15 s deadline instead of fixed sleeps.
- **Backups:** in WAL mode, copying only the `.db` file while the service runs can lose recent writes. Document an online backup using Python's `sqlite3` backup API.

## Scope
In:
- `scripts/smoke.py` (new)
- `deploy/notes-api.service` (new)
- `docs/operations.md` (new)
- `README.md`: a Deployment section linking the guide
- `.github/workflows/ci.yml`: add a smoke step
- `pyproject.toml`: `[tool.mypy] files = ["app", "scripts"]`

Out: Dockerfile, reverse-proxy configuration, configuration management (Ansible etc.), lockfile.

## Steps
1. `scripts/smoke.py`, fully type-annotated, using `httpx`. The steps, in order:
   1. Start the server with `NOTES_DB_PATH=<tmp>/notes.db`, wait for `/health` to return 200.
   2. POST two notes with tags.
   3. `GET /notes?tag=<tag>` returns exactly 1.
   4. PATCH the title and tags; GET shows the changes.
   5. DELETE one note, which returns 204; GET on it returns 404.
   6. Stop the server, start it again on the same DB, GET the remaining note and compare its fields.
   7. Print `smoke OK` and exit 0.

   Any failure prints the step name and exits 1.
2. `deploy/notes-api.service`:
   ```ini
   [Unit]
   Description=Internal notes API
   After=network.target

   [Service]
   Type=simple
   User=notes-api
   Group=notes-api
   WorkingDirectory=/opt/notes-api
   Environment=NOTES_DB_PATH=/var/lib/notes-api/notes.db
   Environment=NOTES_LOG_LEVEL=INFO
   ExecStart=/opt/notes-api/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
   StateDirectory=notes-api
   Restart=on-failure
   NoNewPrivileges=yes
   ProtectSystem=strict
   ProtectHome=yes
   PrivateTmp=yes

   [Install]
   WantedBy=multi-user.target
   ```
3. `docs/operations.md`, with these sections:
   - prerequisites (Linux, `python3.12`, `python3.12-venv`)
   - install (create the user, copy the code to `/opt/notes-api`, create the venv, `pip install .`)
   - configuration (the environment variables)
   - systemd (install the unit, `systemctl enable --now`, `journalctl -u notes-api`)
   - health check (`curl -fsS 127.0.0.1:8000/health`)
   - backup and restore (the online backup one-liner below; restore = stop the service, replace the file, start)
   - upgrade (back up, update the code, reinstall, restart; migrations run automatically at startup)
   - security (no auth: bind to localhost or an internal interface, firewall, optional reverse proxy)
   - why a single worker
4. The backup one-liner for the guide:
   `/opt/notes-api/.venv/bin/python -c "import sqlite3; s = sqlite3.connect('/var/lib/notes-api/notes.db'); d = sqlite3.connect('/var/backups/notes-api/notes.db'); s.backup(d); d.close(); s.close()"`
5. CI: after the pytest step, add `- run: python scripts/smoke.py`.
6. README: a Deployment section linking to `docs/operations.md`, plus the smoke command.

## Acceptance criteria
- [ ] `.venv/bin/python scripts/smoke.py` exits 0 and prints `smoke OK`. It covers create, filtered list, patch, delete and 404, plus persistence across a restart.
- [ ] After the script exits, no uvicorn child process is left running, and no files are created outside the temporary directory.
- [ ] `deploy/notes-api.service` contains:
  - `--host 127.0.0.1` and `--workers 1`
  - `NOTES_DB_PATH=/var/lib/notes-api/notes.db` and `StateDirectory=notes-api`
  - `Restart=on-failure`
  - `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`
- [ ] `docs/operations.md` covers every section listed in step 3, including the no-auth warning and the online backup procedure.
- [ ] The CI workflow runs `python scripts/smoke.py` after the tests.
- [ ] mypy checks `scripts/`, and it passes.
- [ ] `README.md` links to `docs/operations.md`.
- [ ] All Check commands pass; coverage ≥ 90%.

## Verification
```sh
.venv/bin/python scripts/smoke.py
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format --check .
.venv/bin/python -m mypy
.venv/bin/python -m pytest -q --cov=app --cov-report=term-missing --cov-fail-under=90
grep -q -- "--workers 1" deploy/notes-api.service
grep -q -- "--host 127.0.0.1" deploy/notes-api.service
grep -q "NOTES_DB_PATH=/var/lib/notes-api/notes.db" deploy/notes-api.service
grep -q "StateDirectory=notes-api" deploy/notes-api.service
grep -q "ProtectSystem=strict" deploy/notes-api.service
grep -q "scripts/smoke.py" .github/workflows/ci.yml
grep -qi "backup" docs/operations.md
grep -qi "no authentication" docs/operations.md
grep -q "docs/operations.md" README.md
```
All commands exit 0. The smoke script finishes in under 30 s on a typical machine.

## Risks and notes
- **Process management:** a slow CI runner could hit the 15 s health deadline. If that happens, raise the deadline; don't add sleeps.
- **Unit file:** it can't be validated with `systemd-analyze verify` here, because its paths don't exist on dev machines. Review it by reading.
- **Open question 2:** if the answer is containers, add a follow-up task for a Dockerfile. The smoke script stays useful either way.
</br>
