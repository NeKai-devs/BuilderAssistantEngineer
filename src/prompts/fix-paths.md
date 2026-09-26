Your plan cites paths as existing code, but they are not in the repository and are not marked as new:

{{paths}}

Fix only these citations:
- If you meant a file or directory that exists, replace the path with the correct one. Check the repository files below, or read the repository if you can.
- If the plan creates it, keep it and write (new) right after it, like `src/teams/store.ts` (new).
- If a `path:line` citation points past the end of the file, correct the line range.
- If the claim is not supported by the repository, remove it.

Change nothing else. Output only the files below that contain these paths, each complete, in the same block format, and nothing outside the blocks:

<<<FILE: path/to/file.md>>>
full file content
<<<END FILE>>>

<files>
{{files}}
</files>

<repository_files>
{{repo_files}}
</repository_files>
