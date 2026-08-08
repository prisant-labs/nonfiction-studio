---
title: "doctor skill reference"
description: "Reference for the doctor skill - the bible integrity front door that wraps bin/ns-doctor in one Bash call per invocation, maps exit codes to grouped findings with routing hints, and writes nothing in v1"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "doctor", "integrity", "schema", "validation", "orphan", "migrate"]
---

# doctor

The `doctor` skill is the bible integrity front door per D-12 (versioned bible with a doctor) and S-06 3.11 (skills and invocation surface). It fronts `bin/ns-doctor` with a single Bash call per invocation, maps the exit code to a presented result, and groups findings by check type with routing hints. The skill and engine are both read-only in v1: no file is written in any mode. It is governed by D-05 (five shipped CLIs), D-06 (single-writer state discipline), and D-12 (versioned bible with a doctor).

## Purpose

`doctor` bridges the deterministic bible integrity engine and the author conversation. The `bin/ns-doctor` engine it invokes runs up to ten checks (bible structure, progress.json schema, meta.json and config.json shape, EV grammar, SRC grammar, orphan claim markers, orphan SRC references, word-count coherence, config-coercion notice, snapshot naming) composed into a single pass. The skill's role is to select the right mode flag, invoke the engine, and present the verdict honestly with per-group counts and routing hints.

**v1 writes nothing.** The engine is read-only per its READ-ONLY COVENANT (grep-proven at TSK-028 (ns-doctor engine)). The skill adds no log file. The `.studio/logs/doctor-<ts>.json` write and bible mutations that appear in the S-06 3.11 specification predate the built engine and describe the Phase 2 `fix` mode contract.

**The fix mode is not in v1.** The skill responds to a `fix` argument by stating it is Phase 2+ scope. The `fix` contract recorded for Phase 2 is: dry-run default, explicit `apply` argument required, fixable-issue list (duplicate EV IDs, malformed JSONL log lines, broken internal cross-references), and a change log written to `.studio/logs/doctor-<ts>.json`.

**No agents invoked.** This is a deterministic-CLI-only skill in Phase 1. No chain edges exist.

## Invocation

```
/nonfiction-studio:doctor [mode]
```

The mode argument is optional; the default is `report`.

| Mode | Description |
|---|---|
| `report` (default) | Full 10-check inventory; exit 0 (clean), exit 1 (findings), exit 2 (error or migration-required prelude) |
| `migrate` | Schema-version diagnosis only; never writes; exit 2 in all cases (no-migrations or migration-required) |
| `packs` | Craft-pack validity check; exit 0 in all v1 cases (no packs directory or no validator yet) |
| `fix` | Not in v1; the skill declines and states the Phase 2 contract |
| `validate` | Alias for `report`; subsumed in v1 (the check inventory covers all schema validation) |

Alternate entry points:
- Via the `studio` dispatcher: routes here from Path 5 (Troubleshoot or get help) for structural problems
- Via `status-dashboard`: routes here when `progress.json` is malformed or unreadable
- Via `run-quality-gate`: routes here when the gate exits 2 with an engine error

## Inputs and Outputs

### Inputs

| Path | When it is read | Why |
|---|---|---|
| `.studio/meta.json` | Step 3 (via engine) | Schema-version check; required fields (schema_version, created, plugin_version_at_creation) |
| `.studio/progress.json` | Step 3 (via engine) | Schema validation against `templates/book-scaffold/.studio/progress.schema.json` |
| `.studio/config.json` | Step 3 (via engine) | Shape check (version integer, gate object, gate.mode enum); config-coercion notice |
| `.studio/snapshots/` | Step 3 (via engine) | Filename conformance check against `<slug>.<YYYYMMDDTHHMMSSZ>.md` pattern |
| `research/evidence-log.md` | Step 3 (via engine) | EV grammar (required fields, enum values, SRC ID format); orphan-marker cross-reference |
| `research/sources.md` | Step 3 (via engine) | SRC grammar (type enum, retrieval-status enum); SRC cross-reference check |
| `chapters/*.md` | Step 3 (via engine) | Scanned for `[claim: EV-nnnn]` markers in the orphan-marker check |

### Outputs

The skill writes no files. All reads are performed by `bin/ns-doctor` under its READ-ONLY COVENANT.

| Path | Written by | Notes |
|---|---|---|
| (none in v1) | - | The `.studio/logs/doctor-<ts>.json` write arrives with `fix` in Phase 2 |

## Flow Summary

The skill runs four steps.

1. **Argument parsing (no tool call).** Extracts the mode from the supplied argument. Default is `report`. Recognizes `report`, `migrate`, `packs`, and `validate` (treated as `report`). Declines `fix` as Phase 2+ scope and halts without any tool calls. Declines unknown tokens and halts.

2. **Resolve the plugin root.** Before the engine is invoked, the skill resolves the plugin's installed path: a primary lookup against `extraKnownMarketplaces['nonfiction-studio'].source.path` in `~/.claude/settings.json`, a `~/.claude/plugins/cache` search fallback, and a dev-mode fallback that checks for `bin/ns-doctor` in the current directory. This is the same three-tier convention `init-project` uses to locate its scaffold templates; it exists because a literal relative `bin/ns-doctor` path resolves against the invoking shell's working directory, not the installed plugin, and would silently fail for a marketplace-installed author. If all three lookups fail, the skill halts and names the settings.json and cache paths it attempted.

3. **Single Bash invocation (one call per mode).** Runs one Bash call: `node "<plugin-root>/bin/ns-doctor" --project=. [--report|--migrate|--validate-packs] --json`. Captures exit code, stdout (JSON), and stderr. No individual sub-CLI calls are made; the engine composes its checks internally.

4. **Present the result (exit-code mapping).** Maps exit code to the presented verdict:
   - **Report mode, exit 0:** clean pass; no findings; names the ten checks run.
   - **Report mode, exit 1:** findings grouped by check-type prefix with per-group counts and routing hints; closes with total count and re-run invitation.
   - **Report mode, exit 2:** surfaces stderr error; NEVER treated as a pass.
   - **Migrate mode:** exit 2 always; distinguishes the no-migrations case (stdout JSON) from the migration-required case (stderr content) and presents each clearly.
   - **Packs mode, exit 0:** presents the stdout JSON `message` field.

## Exit-Code Mapping

| Mode | Exit code | Meaning | Skill action |
|---|---|---|---|
| `report` | 0 | All checks passed; no findings | Present clean pass; name the ten checks; note any notices |
| `report` | 1 | One or more findings | Present grouped findings with counts and routing hints; invite re-run |
| `report` | 2 | Operational error (e.g. BibleError, bad args) or schema-version prelude | Surface stderr; NEVER treat as a pass; route to `doctor migrate` if version mismatch indicated |
| `migrate` | 2 | Always: either no-migrations-defined or migration-required | Present the appropriate case; note writes are never performed in v1 |
| `packs` | 0 | Always in v1: no packs directory or no validator yet | Present the stdout message field |

## Check Inventory (Report Mode)

The engine runs ten checks in order. The `type` prefix of each finding identifies the group.

| Check | Engine section | Finding type prefix | What it checks |
|---|---|---|---|
| Bible structure | 1 | `structure` | Scaffold-mandated paths: `.studio/progress.json`, `.studio/config.json`, `.studio/ai-use-log.jsonl`, `research/evidence-log.md`, `research/sources.md`, `context/style-profile.md`, `context/brief.md`, `structure/thesis.md`, `structure/outline.md` |
| progress.json schema | 2 | `schema` | JSON validity and conformance against `templates/book-scaffold/.studio/progress.schema.json`; additionalProperties-tolerant |
| meta.json and config.json shape | 3 | `shape` | Required field presence and types; enum values for `gate.mode`; additionalProperties-tolerant |
| EV grammar | 4 | `ev-grammar` | Required fields, confidence and status enum values, SRC ID format in `research/evidence-log.md` |
| SRC grammar | 5 | `src-grammar` | type and retrieval-status enum values in `research/sources.md` |
| Orphan claim markers | 6 | `claim-marker` | `[claim: EV-nnnn]` markers in chapter files that reference EV IDs absent from the ledger |
| Orphan SRC references | 7 | `src-ref` | SRC IDs referenced in EV entries but absent from sources.md; SRC IDs defined in sources.md but referenced by no EV entry |
| Word-count coherence | 8 | `coherence` | Chapter word count in progress.json matches the file on disk (single authority: stylometry tokenizer per TSK-029b (state-coherence gate check)) |
| Config-coercion notice | 9 | `config-coercion` | Reports `thesis_alignment.mode: block` as a notice (informational; never affects exit code; D-03 (layered Stop gate) coercion happens at gate time, not here) |
| Snapshot naming | 10 | `snapshot` | Files in `.studio/snapshots/` match the pattern `<slug>.<YYYYMMDDTHHMMSSZ>.md` |

## Finding Grouping and Routing Hints

When exit 1 is returned, findings are grouped by the prefix of their `type` field. Routing hints are presented per group.

| Group prefix(es) | Display name | Routing hint |
|---|---|---|
| `structure` | Bible structure | Re-run `/nonfiction-studio:init-project` to re-stamp missing scaffold paths (idempotent for existing content), or create the named path manually. |
| `schema`, `shape` | Schema and shape | Inspect the named file and field; correct the type, add the missing required field, or fix the invalid JSON. |
| `ev-grammar` | Evidence log grammar | Edit `research/evidence-log.md` to correct the named entry: add missing required fields, fix confidence or status enum values, or correct the SRC ID format. |
| `src-grammar` | Sources grammar | Edit `research/sources.md` to correct the named entry: fix the type or retrieval-status enum value. |
| `claim-marker` | Orphan claim markers | Run `/nonfiction-studio:fact-check-pass <slug>` to reconcile chapter markers and the evidence ledger. |
| `src-ref` | Orphan SRC references | Run `/nonfiction-studio:research-pass` to add the missing SRC entry, or `/nonfiction-studio:fact-check-pass` to reconcile cross-references. |
| `coherence` | Word-count coherence | This typically self-resolves when the PostToolBatch hook runs on the next chapter write. If the mismatch persists, check whether a manual edit bypassed the hook. |
| `snapshot` | Snapshot naming | Rename the file in `.studio/snapshots/` to match the pattern `<slug>.<YYYYMMDDTHHMMSSZ>.md`. |

## Migrate Mode

`--migrate` exits 2 in all cases in v1. Two cases are possible:

**No-migrations case (stdout JSON with `"status": "no-migrations"`).** The schema version is current; no migrations are defined for the current-to-current version pair. Migrations arrive with the first schema change per Q-04 (release, versioning, and compatibility). No files are written.

**Migration-required case (stderr content).** The bible's `schema_version` in `.studio/meta.json` is older than the supported major (`2`). The engine names both versions in the stderr message. No migration is applied in v1; the snapshot-before-migrate and restore-on-failure contract activates when real migrations arrive per Q-04 (release, versioning, and compatibility). No files are written.

## Packs Mode

`--validate-packs` exits 0 in all v1 cases. Two sub-cases:

- **No packs directory:** exits 0 with message "no packs directory found; craft-model packs ship in Phase 2 per D-21".
- **Packs directory exists but no validator:** exits 0 with message "packs directory found but pack schema validation is not yet implemented (Phase 2)".

No files are written.

## Surface Behavior

The doctor skill works identically on all three surfaces per D-14 (three-surface compatibility). All reads use the Bash tool and engine internals, which are available on all surfaces. No surface-conditional behavior exists.

## Failure Behavior

**`fix` argument supplied.** Step 1 declines as Phase 2 and halts without any tool calls. No engine invocation, no file reads.

**Unrecognized mode argument.** Step 1 declines and halts without any tool calls. No engine invocation.

**Exit 2 from `--report`.** Step 4 surfaces the stderr and halts. Never treated as a pass. If the error message indicates a schema version mismatch, suggests running `doctor migrate` for the explicit diagnosis.

**Exit 2 from `--migrate`.** Expected behavior; not an unexpected error. Step 4 distinguishes the two cases and presents the appropriate message.

**Exit 2 from `--validate-packs`.** Unexpected in v1. Step 4 surfaces the stderr and halts.

**Project root not found.** `findBookRoot` exits 2 with a `BibleError` on stderr when `.studio/meta.json` is not found at or above the current directory. The skill surfaces the error and notes that `.studio/meta.json` must be present at the project root.

## Worked Example

See [doctor.example.md](./doctor.example.md) for a condensed transcript of a `doctor report` session over the committed two-chapter sample book "The Quiet Network" (see `examples/sample-book/`). The example is grounded in a live `--report --json` run against the committed fixture that exited 0 with verdict `valid` and no findings, followed by a synthetic findings illustration using the engine's real finding-type strings.
