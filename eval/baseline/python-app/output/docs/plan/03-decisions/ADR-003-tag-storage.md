# ADR-003: Store tags as rows in a `note_tags` table, normalized to lowercase

- Status: accepted
- Date: 2026-09-26

## Context
Notes carry tags (from the brief). Tags must be listed with each note and used as a list filter (FR-3). No tag metadata is required: no colors, descriptions or renames through the API.

## Decision
- **Table:** `note_tags(note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (note_id, tag)) WITHOUT ROWID`, plus an index `(tag, note_id)` for filtering.
- **No separate `tags` table.**
- **Normalization:** in `schemas.normalize_tag()`. Tags are stripped of surrounding whitespace, lowercased, and must match `^[a-z0-9][a-z0-9_-]{0,31}$`.
- **Duplicates:** removed before storage. Responses return tags sorted.
- **Filtering:** by `note_id IN (SELECT note_id FROM note_tags WHERE tag IN (...) GROUP BY note_id HAVING COUNT(*) = :n_distinct)`, which gives AND semantics.

## Alternatives considered
- **`tags` table plus a many-to-many join table:** lost. It adds an extra table and orphan cleanup, and it pays off only if tags gain their own attributes.
- **JSON array column on `notes`:** lost. Filtering needs `json_each` scans with no index, and nothing guarantees uniqueness.
- **Comma-separated text:** lost. It has the same filtering problems, plus escaping issues.
- **Case-sensitive tags:** lost. "Work" and "work" as separate tags is a common source of confusion; open question 3 may revisit this.

## Consequences
- Renaming a tag everywhere is a single UPDATE, if it's ever needed.
- A future `GET /tags` endpoint is a `GROUP BY` query.
- Tag metadata would need a new table (a migration).
- Unicode tags are rejected by design, pending the answer to open question 3.
