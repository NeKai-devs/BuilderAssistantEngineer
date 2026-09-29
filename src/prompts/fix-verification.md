The CLI cannot accept the Verification block of these task files, or these project commands (CONFIG):

{{problems}}

Fix only the Verification section of each file, and only the CONFIG commands listed, as each line above says, and keep everything else unchanged. The Verification block runs as one bash script with `set -Eeuo pipefail`, and every line must exit 0 when the task is done:
- Run the project's test runner, linter or build, or a check with an expected result (`test -f`, `grep -q`, `curl -sf`, `git diff --exit-code`).
- Never hide a failure: no `|| true`, `|| :`, `|| echo`, `; true` or `set +e`, and no check run in the background.
- Unattended runs execute only known runners and checks: package managers, language toolchains (also through the repository's virtualenv, such as `.venv/bin/python -m pytest`), test runners, linters, make, read-only git, `test`, `grep`, `diff`, `curl` and `jq`. Run project scripts with `sh script.sh` or `node script.js` rather than by path, send data with curl only to a local server, and avoid inline code (`node -e`, `python -c`), `$( )`, `eval` and nested shells such as `bash -c`.
- To check a server, one command per line: start it in the background (`python3 app.py &`), stop it when the script ends (`trap 'kill $!' EXIT`), wait for it (`sleep 1`), then query it with `curl -sf http://127.0.0.1:8000/`, which fails on an HTTP error.

Output only the blocks below, each complete, in the same block format, and nothing outside the blocks: the CONFIG block when it is included below, and every file:

<<<CONFIG>>>
{"commands": {"test": "...", "lint": "...", "typecheck": "...", "build": "..."}}
<<<END CONFIG>>>
<<<FILE: path/to/file.md>>>
full file content
<<<END FILE>>>

<files>
{{files}}
</files>
