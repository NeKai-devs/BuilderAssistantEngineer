# Eval baseline

- Backend: claude
- Models: claude-opus-5-5
- Language: en; targets: claude-code,opencode
- analyst.md sha256: 6e1e7044f25f; tool commit: e68134b; date: 2026-09-26

| Fixture | Mode | Exit | Files | Tasks | Tasks with verification | file:line refs valid | Cited paths that exist | Questions (blocking) | Continuations | Format retries | Minutes | Cost USD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| docs-only | greenfield | 0 | 47 | 18 | 18/18 (100%) | n/a | 14/231 (6%) | 5 (0) | 0 | 1 | 40.6 | 7.18 |
| go-service | brownfield | 0 | 30 | 5 | 5/5 (100%) | 13/13 (100%) | 36/112 (32%) | 5 (0) | 0 | 0 | 11.3 | 1.66 |
| node-app | brownfield | 0 | 36 | 8 | 8/8 (100%) | 1/1 (100%) | 22/113 (19%) | 5 (0) | 0 | 0 | 11.9 | 1.94 |
| python-app | brownfield | 0 | 33 | 8 | 8/8 (100%) | 14/14 (100%) | 34/90 (38%) | 5 (0) | 0 | 0 | 15.3 | 2.34 |
| **Total** |  | 4/4 ok | 146 | 39 | 39/39 (100%) | 28/28 (100%) | 106/546 (19%) | 20 (0) | 0 | 1 | 79.2 | 13.13 |
