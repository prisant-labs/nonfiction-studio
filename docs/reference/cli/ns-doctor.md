---
title: "ns-doctor CLI reference"
description: "Reference for the ns-doctor CLI - bible integrity validator and state-coherence checker"
audience: "non-engineer"
level: "beginner"
tags: ["cli", "doctor", "integrity", "schema", "coherence"]
---

# ns-doctor

Validates the book project's bible structure, schema versions, EV/SRC grammar, orphan
references, word-count coherence, snapshot naming, config shape, style-profile
structure and baseline consistency, and ai-use-log chapter coverage. Exits 0 when the
bible is clean; exits 1 when findings are present; exits 2 on schema migration required
or operational error.

## Purpose

`ns-doctor` is the bible integrity validator per S-07 (hooks and scripts). It is the
single-source word-counting authority (using the same tokenizer as `bin/ns-stylometry`
per the banked adjudication of 2026-07-18) and the only CLI that checks word-count
coherence between chapter files and `progress.json`. This coherence check is the
deterministic catch for the `unsourced-claim` fixture (an extra sentence raises the
chapter's word count above the value recorded in progress.json, triggering a named
finding before any model call).

## Invocation

```
ns-doctor [--check | --report] [--migrate] [--validate-packs] [--project=<dir>] [--json]
ns-doctor --adopt-plan [--chapters-dir=<name>] [--project=<dir>] [--json]
```

## Windows invocation

Bare `ns-doctor` invocation fails in the Bash tool on Windows; the plugin
system does not add `bin/` to PATH (ADR-0005, bin PATH on Windows). Hook, skill,
and agent contexts must resolve the plugin root first, then invoke:

```
node "<plugin-root>/bin/ns-doctor" [--check | --report] [--migrate] [--validate-packs] [--project=<dir>] [--json]
```

where `<plugin-root>` is the resolved plugin installation path. Direct
interactive invocation from a user's own shell can add `bin/` to PATH manually,
or use the same `node` plus full-path form.

## Flags

| Flag | Type | Description |
|---|---|---|
| `--check` | boolean | Run the full check inventory (default when no mode flag is supplied). |
| `--report` | boolean | Synonym for `--check` in v1; both run the same inventory. |
| `--migrate` | boolean | Check whether a migration is available for the current schema version; exits 0 with a nothing-to-migrate message when the schema is already current, exits 2 when migration is required (an incompatible version). |
| `--validate-packs` | boolean | Validate craft-model packs in `packs/`; exits 0 cleanly when no packs directory exists (Phase 2 feature). |
| `--adopt-plan` | boolean | Print the read-only adoption plan for the directory itself, without walking up; see "Adoption plan" below. Always prints JSON; `--json` is accepted and changes nothing. |
| `--chapters-dir=<name>` | string | With `--adopt-plan`, list the chapters of that candidate folder instead of the one with the most Markdown files. A name that is not a candidate exits 2 and names the candidates. |
| `--project=<dir>` | string | Override the book root to `<dir>`. If omitted, walks up from the current directory looking for a book root: `context/` and `chapters/`, or a `nonfiction-studio.json` that names the book's chapters folder (an adopted book), with `meta.json` in the state folder (`_nonfiction-studio/`, or the name recorded in `nonfiction-studio.json`). |
| `--json` | boolean | Emit the full result as JSON to stdout. |

## Exit taxonomy

| Exit code | Meaning |
|---|---|
| 0 | Pass - bible is valid, no findings |
| 1 | One or more findings (structure, schema, grammar, coherence, naming, or malformed ai-use-log line violations) |
| 2 | Migration required (schema_version mismatch), an unresolved state folder (see below), argument error, or operational failure |

### Unresolved state folder

When a book root has its bible folders but the engine cannot tell where its records are, `ns-doctor` runs no checks. It exits 2 and reports the problem in the normal report shape, as JSON with `--json` and as text without it. The checks cannot run until the folder is resolved, so this is never a pass. See [ADR-0015 (state folder name)](../../adr/ADR-0015-state-folder-name.md).

| `status` | Cause | Finding |
|---|---|---|
| `state-folder-unpointed` | A folder at the book root holds `meta.json` and `progress.json`, but neither the default name nor `nonfiction-studio.json` points to it; for example, the legacy `.studio/` of a book created before ADR-0015 | One `state.unpointed-folder` finding per such folder, with the folder as its `path` |
| `state-pointer-invalid` | `nonfiction-studio.json` is unreadable or malformed, names an invalid folder, or names a folder without `meta.json` | One `state.pointer-invalid` finding, with `nonfiction-studio.json` as its `path` |

The `nfs-doctor` skill reads these findings to offer its `migrate` fix, or to describe the pointer repair.

## Check inventory

`ns-doctor` runs twelve checks in order. In an adopted book ([ADR-0016 (adopting an existing book)](../../adr/ADR-0016-adopting-an-existing-book.md)), each element the book has not adopted is first reported as an `element-not-adopted` notice, never a finding, with the element in its `element` field and the way to adopt it in its message. The doctor then reads none of that element's files: the bible paths in check 1 are required only for adopted elements, checks 4 to 7 run only once `claims` is adopted, and check 11 only once `style` is. An adopted book's chapters are those in the folder its pointer names, and every chapter read measures prose only, cut at `config.json`'s `prose.ends_at_heading` when the book sets one.

1. **Bible structure** - all scaffold-mandated paths are present (progress.json, config.json, evidence-log.md, etc.)
2. **progress.json schema** - validated against `templates/book-scaffold/_nonfiction-studio/progress.schema.json`; missing or wrong-typed required fields are named findings
3. **meta.json and config.json shape** - required fields and enum values; unknown fields tolerated per S-08 Rule 2. An `adoption` object, when present, must hold a `YYYY-MM-DD` `date`, a state of `adopted` or `not-adopted` for each of the five elements with `chapters` always `adopted`, and well-formed `shared_folders` entries; the adoption reader fails closed, so this check is what makes a malformed record visible
4. **EV grammar** - every evidence entry has required fields with valid enum values
5. **SRC grammar** - every source entry has required fields with valid enum values
6. **Orphan claim markers** - chapter `[claim: EV-nnnn]` markers whose EV ID is absent from the ledger
7. **Orphan SRC references** - EV entries referencing SRC IDs not in sources.md, and vice versa
8. **Word-count coherence** - chapter file word counts vs progress.json recorded values; names the chapter and both counts on mismatch
9. **Config coercion notice** - informational report when thesis_alignment is set to block (D-03 coerces it to warn at gate time); never affects exit code
10. **Snapshot naming** - `_nonfiction-studio/snapshots/` files must match `<slug>.<YYYYMMDDTHHMMSS[mmm]Z>[-N].md`
11. **Style profile structure** - `context/style-profile.md` (F-CI-08, voice quality unchecked, deterministic half): a pre-capture stub (no `# Style profile` heading) is a NOTICE unless `config.json` already carries a stylometry baseline, in which case it is a finding; once populated, the seven required sections (`## Voice`, `## Diction`, `## Rhythm`, `## Do`, `## Do not`, `## Exemplars`, `## Baseline reference`) must be present and in order, the `Baseline reference` block's `vector`, `captured`, and `sample_count` fields must be present, `captured` and `sample_count` must agree with `config.json`'s stylometry baseline when one exists, and every `Exemplars` path must resolve relative to the book root
12. **ai-use-log coverage** - `_nonfiction-studio/ai-use-log.jsonl` (Task 5, Wave 1 exit: chat compliance parity), parsed tolerantly (blank lines are fine; a non-blank line that fails to parse as JSON is a named finding, naming its line number - the one place this checker does not silently discard a partial line the way other readers do). Per `chapters/*.md` file: a filesystem mtime newer than the newest record whose `targets` array names it, or no covering record at all, is an "uncovered writing window" NOTICE (never a finding). The report always states the coverage fraction: `ai-use-log covers N of M chapters with writes`, where `M` is chapters on disk and `N` is chapters with at least one covering record by presence, independent of mtime. A fresh git checkout stamps every file's mtime to checkout time, which postdates any committed log record, so the uncovered-writing-window notice can legitimately fire even on a fully, currently-covered book.

## Adoption plan (`--adopt-plan`)

`ns-doctor --adopt-plan` is the read-only plan that the `nfs-adopt` skill shows before it writes anything, per [ADR-0016 (adopting an existing book)](../../adr/ADR-0016-adopting-an-existing-book.md). It reads the one directory it is given (the current directory, or `--project`), never walks up to an enclosing book, and writes nothing. It exits 0 with a plan, and 2 when the directory cannot be read or `--chapters-dir` names no candidate. Its output is byte-identical across runs: every list is sorted by code unit, and nothing in it depends on the clock.

| Field | Value |
|---|---|
| `version` | `1` |
| `root` | The directory planned, with forward slashes |
| `book` | `null` when the directory is not itself a book root; otherwise `{ "root", "adopted" }` |
| `pointer` | `null` without `nonfiction-studio.json`; otherwise `{ "valid", "state_dir", "chapters_dir", "reason" }`, naming only the keys the file sets |
| `state_folders` | Folders at the root that hold both `meta.json` and `progress.json` |
| `chapters_candidates` | `{ "folder", "markdown_files" }` for each folder at the root that holds Markdown files directly and that a pointer could name, most files first |
| `chapters_folder` | The candidate the `chapters` list describes: the first candidate, or `--chapters-dir` |
| `chapters` | `{ "file", "slug", "title", "words", "words_whole_file" }` per chapter. `title` is the first level-1 heading, else derived from the slug; `words` is counted on prose with the proposed boundary, `words_whole_file` on the whole file |
| `prose_boundary` | `null`, or `{ "heading", "files_with_heading", "markdown_files" }`: the most common last level-2 heading, proposed when it ends more than half of the chapter files |
| `shared_folders` | `{ "folder", "author_files" }` for each bible folder (`context/`, `structure/`, `research/`, `production/`) that already holds files the plugin did not create |
| `ledger_candidates` | Files anywhere below the root, outside hidden and state folders, whose names contain `ledger` or `claim` |
| `title_candidate` | The first level-1 heading of the top-level `README.md`, or `null` |
| `git` | `null` outside a git working tree; otherwise `{ "work_tree": true, "uncommitted" }`, the number of changed paths under the directory |

## Output

Human-readable pass:

```
[doctor] pass: bible is valid, no issues found
```

Human-readable findings:

```
[doctor] 1 finding(s):
  chapters/02-finding-your-network.md [coherence.word-count-mismatch]: chapter 02-finding-your-network: progress.json records 462 words but the file contains 481 words (by stylometry tokenizer)
```

JSON output (with `--json`) follows the S-08 doctor-report shape with `check`, `schemaVersion`, `status`, `findings`, and `notices` fields.

## Example invocations

Run against the current book project:

```
ns-doctor --check
```

Run against a specific fixture, emitting JSON:

```
ns-doctor --check --project=examples/fixtures/unsourced-claim --json
```

Check migration status:

```
ns-doctor --migrate
```

## Relationship to other CLIs

`ns-doctor`'s word-count coherence check (`checkWordCountCoherence`) is exported and
also called by `bin/ns-gate` as the `state_coherence` check, ensuring one implementation
and two callers per TSK-029b (state-coherence gate check). The `nfs-doctor` skill (user-facing)
invokes `ns-doctor` interactively and formats its output for author consumption.

## See also

- [ns-gate CLI reference](./ns-gate.md) - orchestrator that includes the doctor's coherence check
- [ai-use-log.jsonl format reference](../../formats/ai-use-log.md) - the compliance-log grammar the ai-use-log coverage check (12) reads
- [nfs-doctor skill reference](../skills/nfs-doctor.md) - user-facing skill that invokes ns-doctor
