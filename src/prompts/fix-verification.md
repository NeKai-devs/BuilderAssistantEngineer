The CLI cannot accept the Verification block of these task files:

{{problems}}

Fix only the Verification section of each file, as each line above says, and keep everything else in the files unchanged. The Verification block runs as one bash script with `set -Eeuo pipefail`, and every line must exit 0 when the task is done:
- Run the project's test runner, linter or build, or a check with an expected result (`test -f`, `grep -q`, `curl -sf`, `git diff --exit-code`).
- Never hide a failure: no `|| true`, `|| :`, `|| echo`, `; true` or `set +e`, and no check run in the background.
- To check a server, one command per line: start it in the background (`python3 app.py &`), stop it when the script ends (`trap 'kill $!' EXIT`), wait for it (`sleep 1`), then query it with `curl -sf http://127.0.0.1:8000/`, which fails on an HTTP error.

Output only the files below, each complete, in the same block format, and nothing outside the blocks:

<<<FILE: path/to/file.md>>>
full file content
<<<END FILE>>>

<files>
{{files}}
</files>
