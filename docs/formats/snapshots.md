# Snapshot Format

**Purpose.** This is the normative grammar for chapter snapshot files under `.studio/snapshots/`, defined in S-08 (schemas and file formats) section 10. Snapshots are pre-write full copies of chapter files created by the `PreToolUse` hook before any write to `chapters/`, resolving the audit gap XR-8 (snapshot-retention). The naming rule and retention policy below are authoritative for all writers, readers, and pruning logic. A parser author must be able to implement a conformant reader without consulting any other document.

## Filename pattern

Snapshot files follow this naming rule:

```
.studio/snapshots/<chapter-slug>.<YYYYMMDDTHHMMSSZ>.md
```

For example: `.studio/snapshots/03-the-signal.20260717T154012Z.md`. The two components are:

- `<chapter-slug>`: the two-digit ordinal plus kebab title matching the chapter filename stem (for example, `03-the-signal`), as defined by the `slug` pattern in S-08 section 3.
- `<YYYYMMDDTHHMMSSZ>`: compact ISO 8601 timestamp in UTC, with no colons or hyphens in the time component (for example, `20260717T154012Z`).

## Content

A snapshot is a verbatim full copy of the chapter file at the moment the `PreToolUse` hook fires, before any tool write occurs. It is not a diff. File encoding and line endings match the source chapter file.

## Placement and retention rules

- Snapshots are written by the `PreToolUse` hook only, before any tool write to a file under `chapters/`. No agent writes snapshots directly.
- The prune rule runs at creation time: after writing a new snapshot, the hook lists all snapshots for the same chapter slug sorted by the timestamp in the filename and deletes all but the newest 10.
- Pruning is per chapter slug: a rarely touched chapter keeps its full history while an active chapter rolls forward.
- The author restores a chapter by copying the desired snapshot back over the chapter file. The `nfs-doctor` skill surfaces the available snapshots per chapter.
- Snapshots are never edited after creation. The old snapshot is never overwritten; an old file is only removed during the prune step.

## Example

A snapshot of chapter 03 created before a `drafting-partner` write at 15:40:12 UTC on 2026-07-17:

Filename:

```
.studio/snapshots/03-the-signal.20260717T154012Z.md
```

Content: the verbatim contents of `chapters/03-the-signal.md` at the moment the hook fires.

After this write, if 10 previous snapshots for `03-the-signal` already exist, the oldest is pruned, leaving exactly 10 snapshots for that slug.

## Consumed by

- `PreToolUse` hook (TSK-032 (pre-tool-use hook)): writes one snapshot per tool call that would write to a file under `chapters/`; prunes to the last 10 per slug immediately after writing.
- `nfs-doctor` skill (`bin/ns-doctor`): reads the snapshot directory to surface available snapshots per chapter and to verify retention compliance.
- Author: copies a snapshot over the live chapter file to restore a prior state.
