---
title: "doctor skill reference"
description: "Reference for the doctor skill - the bible integrity front door that wraps bin/ns-doctor in one Bash call per invocation, maps exit codes to grouped findings with routing hints, and (in its report, migrate, and packs modes) writes nothing; a fourth mode, install-statusline, performs one consented write to the author's own Claude Code settings"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "doctor", "integrity", "schema", "validation", "orphan", "migrate"]
---

# doctor

The `doctor` skill is the bible integrity front door per D-12 (versioned bible with a doctor) and S-06 3.11 (skills and invocation surface). It fronts `bin/ns-doctor` with a single Bash call per invocation, maps the exit code to a presented result, and groups findings by check type with routing hints. `bin/ns-doctor` and its engine (`hooks/lib/doctor-engine.mjs`) are read-only without exception, in every mode. The skill's `report`, `migrate`, and `packs` modes write nothing either. A fourth mode, `install-statusline` (OPP-P03, studio HUD; ADR-0008, status HUD and CANON 3.5), writes exactly one file, `~/.claude/settings.json`, and only after the author answers an explicit yes; see "Install-statusline Mode" below. It is governed by D-05 (five shipped CLIs), D-06 (single-writer state discipline), and D-12 (versioned bible with a doctor).

## Purpose

`doctor` bridges the deterministic bible integrity engine and the author conversation. The `bin/ns-doctor` engine it invokes runs up to eleven checks (bible structure, progress.json schema, meta.json and config.json shape, EV grammar, SRC grammar, orphan claim markers, orphan SRC references, word-count coherence, config-coercion notice, snapshot naming, style-profile structure and baseline consistency) composed into a single pass. The skill's role is to select the right mode flag, invoke the engine, and present the verdict honestly with per-group counts and routing hints.

**`bin/ns-doctor` is read-only without exception.** Proven by the grep in the engine's own header (`hooks/lib/doctor-engine.mjs:13-14`; TSK-028, ns-doctor engine). The skill's `report`, `migrate`, and `packs` modes add no log file and write nothing. The `.studio/logs/doctor-<ts>.json` write and bible mutations that appear in the S-06 3.11 specification predate the built engine and describe the Phase 2 `fix` mode contract, unrelated to `install-statusline`.

**`install-statusline` is the one exception, narrowly scoped.** It writes `~/.claude/settings.json`'s `statusLine` key, and only that key, and only on an explicit yes to a stated, one-time consent prompt. The write is performed by the skill itself with the Write or Edit tool; `bin/ns-doctor` is not invoked and is not involved in any way. See "Install-statusline Mode" below.

**The fix mode is not in v1.** The skill responds to a `fix` argument by stating it is Phase 2+ scope. The `fix` contract recorded for Phase 2 is: dry-run default, explicit `apply` argument required, fixable-issue list (duplicate EV IDs, malformed JSONL log lines, broken internal cross-references), and a change log written to `.studio/logs/doctor-<ts>.json`.

**No agents invoked, in any mode.** This is a deterministic-CLI-only skill for `report`, `migrate`, and `packs`. `install-statusline` uses the Write or Edit tool directly, not an agent. No chain edges exist.

## Invocation

```
/nonfiction-studio:doctor [mode]
```

The mode argument is optional; the default is `report`.

| Mode | Description |
|---|---|
| `report` (default) | Full 11-check inventory; exit 0 (clean), exit 1 (findings), exit 2 (error or migration-required prelude) |
| `migrate` | Schema-version diagnosis only; never writes; exit 0 when already current, exit 2 when migration is required (genuinely incompatible version) |
| `packs` | Craft-pack validity check; exit 0 in all v1 cases (no packs directory or no validator yet) |
| `install-statusline` | Offers a one-time consented write of the main Claude Code status line into `~/.claude/settings.json`; does not invoke `bin/ns-doctor`; writes only on an explicit yes |
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
| `context/style-profile.md` | Step 3 (via engine) | Style-profile structure (seven sections, present and in order); Baseline reference field completeness; agreement with `config.json`'s stylometry baseline; Exemplars path resolution; a pre-capture stub is a notice unless `config.json` already carries a baseline |
| `~/.claude/settings.json` | `install-statusline` mode only, by the skill itself (not the engine) | Read first to merge into, never to validate against the bible; a user-scope file, outside any book project |

### Outputs

`bin/ns-doctor` writes no files, in any mode, without exception - the engine performs every read
in `report`, `migrate`, and `packs`. The skill itself writes exactly one file, in exactly one
mode: `install-statusline` writes `~/.claude/settings.json`'s `statusLine` key, and only after the
author answers an explicit yes to a stated consent prompt. See "Install-statusline Mode" below.

| Path | Written by | Notes |
|---|---|---|
| `~/.claude/settings.json` | the skill, `install-statusline` mode only, on explicit yes | Merges a `statusLine` entry; every other existing top-level key is preserved; a pre-existing `statusLine` requires a separate explicit confirmation before being replaced |
| (none, all other modes) | - | The `.studio/logs/doctor-<ts>.json` write arrives with `fix` in Phase 2, unrelated to `install-statusline` |

## Flow Summary

`report`, `migrate`, and `packs` run four steps each. `install-statusline` is a separate four-step
flow (Steps A-D) that never invokes `bin/ns-doctor` at all; see "Install-statusline Mode" below.

1. **Argument parsing (no tool call).** Extracts the mode from the supplied argument. Default is `report`. Recognizes `report`, `migrate`, `packs`, `install-statusline`, and `validate` (treated as `report`). Declines `fix` as Phase 2+ scope and halts without any tool calls. Declines unknown tokens and halts. An `install-statusline` mode skips straight to its own flow, below.

2. **Resolve the plugin root.** Before the engine is invoked, the skill resolves the plugin's installed path: a primary lookup against `extraKnownMarketplaces['nonfiction-studio'].source.path` in `~/.claude/settings.json`, a `~/.claude/plugins/cache` search fallback, and a dev-mode fallback that checks for `bin/ns-doctor` in the current directory. This is the same three-tier convention `init-project` uses to locate its scaffold templates; it exists because a literal relative `bin/ns-doctor` path resolves against the invoking shell's working directory, not the installed plugin, and would silently fail for a marketplace-installed author. If all three lookups fail, the skill halts and names the settings.json and cache paths it attempted. (`install-statusline` reuses this same resolution as its own Step A, but for a different purpose: composing the command string it proposes to install, not for locating `bin/ns-doctor`.)

3. **Single Bash invocation (one call per mode).** Runs one Bash call: `node "<plugin-root>/bin/ns-doctor" --project=. [--report|--migrate|--validate-packs] --json`. Captures exit code, stdout (JSON), and stderr. No individual sub-CLI calls are made; the engine composes its checks internally.

4. **Present the result (exit-code mapping).** Maps exit code to the presented verdict:
   - **Report mode, exit 0:** clean pass; no findings; names the eleven checks run.
   - **Report mode, exit 1:** findings grouped by check-type prefix with per-group counts and routing hints; closes with total count and re-run invitation.
   - **Report mode, exit 2:** surfaces stderr error; NEVER treated as a pass.
   - **Migrate mode:** exit 0 when the schema is already current (stdout JSON with status "current"); exit 2 when migration is required (stderr content); presents each clearly.
   - **Packs mode, exit 0:** presents the stdout JSON `message` field.

## Exit-Code Mapping

| Mode | Exit code | Meaning | Skill action |
|---|---|---|---|
| `report` | 0 | All checks passed; no findings | Present clean pass; name the eleven checks; note any notices |
| `report` | 1 | One or more findings | Present grouped findings with counts and routing hints; invite re-run |
| `report` | 2 | Operational error (e.g. BibleError, bad args) or schema-version prelude | Surface stderr; NEVER treat as a pass; route to `doctor migrate` if version mismatch indicated |
| `migrate` | 0 | Schema is already current; nothing to migrate | Present the current-schema message; note writes are never performed in v1 |
| `migrate` | 2 | Migration required (genuinely incompatible version) | Present the migration-required message; note writes are never performed in v1 |
| `packs` | 0 | Always in v1: no packs directory or no validator yet | Present the stdout message field |
| `install-statusline` | n/a | This mode never invokes `bin/ns-doctor`, so it produces no CLI exit code; its outcome is binary instead (wrote the file on an explicit yes, or wrote nothing) | See "Install-statusline Mode" below |

## Check Inventory (Report Mode)

The engine runs eleven checks in order. The `type` prefix of each finding identifies the group.

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
| Style profile structure | 11 | `style-profile` | `context/style-profile.md` (F-CI-08, voice quality unchecked, deterministic half): a pre-capture stub is a notice unless `config.json` already carries a stylometry baseline (then a finding); once populated, all seven sections present and in order, the `Baseline reference` block's three required fields, agreement with `config.json`'s stylometry baseline when one exists, and Exemplars path resolution |

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
| `style-profile` | Style profile structure | Edit `context/style-profile.md` to add the named missing section, reorder sections, fill in the named `Baseline reference` field, or fix the named `Exemplars` path. A `captured` or `sample_count` disagreement, or a stub sitting alongside an existing `config.json` baseline, typically means re-running `/nonfiction-studio:capture-voice` to resynchronize both files. |

## Migrate Mode

`--migrate` exits 0 when the schema is already current and 2 only when migration is genuinely required (an incompatible version). Two cases are possible:

**Current schema, nothing to migrate (exit 0; stdout JSON with `"status": "current"`).** The schema version is current; no migrations are defined for the current-to-current version pair. Migrations arrive with the first schema change per Q-04 (release, versioning, and compatibility). No files are written.

**Migration required (exit 2; stderr content).** The bible's `schema_version` in `.studio/meta.json` is older than the supported major (`2`). The engine names both versions in the stderr message. No migration is applied in v1; the snapshot-before-migrate and restore-on-failure contract activates when real migrations arrive per Q-04 (release, versioning, and compatibility). No files are written.

## Packs Mode

`--validate-packs` exits 0 in all v1 cases. Two sub-cases:

- **No packs directory:** exits 0 with message "no packs directory found; craft-model packs ship in Phase 2 per D-21".
- **Packs directory exists but no validator:** exits 0 with message "packs directory found but pack schema validation is not yet implemented (Phase 2)".

No files are written.

## Install-statusline Mode

OPP-P03 (studio HUD): "the main statusline installs via a one-time consented `doctor` write,
never silently." This mode is that write, and the only place in this entire plugin any file
under the author's own Claude Code configuration is ever touched. See
[ADR-0008 (status HUD)](../../adr/ADR-0008-status-hud.md) for why no other path exists: a plugin
cannot ship a main status line itself (only `agent` and `subagentStatusLine` are supported plugin
`settings.json` keys), and there is no plugin-to-user consent API of any kind.

Four steps, none of which invoke `bin/ns-doctor`:

- **Step A - resolve the plugin root.** The same three-tier lookup as the `report`/`migrate`/`packs`
  flow's own Step 2, used here to compose the command string this mode proposes to install:
  `node "<plugin-root>/bin/ns-statusline"`. The `CLAUDE_PLUGIN_ROOT` plugin-system interpolation
  placeholder is never used for this value: that token interpolates only inside a plugin's own manifest files
  (`hooks/hooks.json`, this plugin's own `settings.json`), not inside the author's unrelated,
  top-level `~/.claude/settings.json`.
- **Step B - read the author's existing `~/.claude/settings.json`.** Absent is treated as `{}`.
  Present and valid JSON continues. Present and invalid JSON halts before anything is written,
  and directs the author to fix or back up the file, or to use the built-in `/statusline` command
  instead.
- **Step C - state exactly what will be written, and ask.** If a `statusLine` key already exists,
  its current value and the proposed new value are both stated verbatim, and a separate explicit
  confirmation is required before it would be replaced. If none exists, the proposed value and the
  fact that every other existing key is left untouched are stated, then the skill asks a plain
  yes/no question. **This step requires an interactive author.** In a non-interactive (headless)
  context there is nobody to answer, so the skill states that this mode requires an interactive
  session, offers `/statusline` as the alternative, and writes nothing - unlike some other
  skills' low-risk defaults (for example `init-project`'s idempotent re-stamp of missing scaffold
  files), a top-level settings write is exactly the kind of action OPP-P03 requires an explicit
  yes for, so no non-interactive default exists here.
- **Step D - write only on an explicit yes.** A shallow merge of `{"statusLine": {"type":
  "command", "command": "<the composed command string>"}}` over the author's existing settings
  object, preserving every other key, written with the Write tool. The Write tool's own
  permission prompt for this file still appears; the skill does not and cannot suppress it. Any
  answer other than an explicit yes - a no, silence, an unrelated reply, or a halt in Steps A-C -
  writes nothing.

"Exactly one consent prompt" (OPP-P03's acceptance language) means exactly one code path in the
whole plugin can ever write the author's settings, and it cannot run without that explicit yes.

## Surface Behavior

The doctor skill works identically on all three surfaces per D-14 (three-surface compatibility) for `report`, `migrate`, and `packs`. All reads use the Bash tool and engine internals, which are available on all surfaces. `install-statusline` additionally requires an interactive author able to answer its consent question (see "Install-statusline Mode" above); on a non-interactive surface it states that requirement and writes nothing, rather than guessing at consent.

## Failure Behavior

**`fix` argument supplied.** Step 1 declines as Phase 2 and halts without any tool calls. No engine invocation, no file reads.

**Unrecognized mode argument.** Step 1 declines and halts without any tool calls. No engine invocation.

**Exit 2 from `--report`.** Step 4 surfaces the stderr and halts. Never treated as a pass. If the error message indicates a schema version mismatch, suggests running `doctor migrate` for the explicit diagnosis.

**Exit 2 from `--migrate`.** Expected behavior when migration is genuinely required (an incompatible schema version); an already-current schema now exits 0 instead. Not an unexpected error. Step 4 distinguishes the two cases and presents the appropriate message.

**Exit 2 from `--validate-packs`.** Unexpected in v1. Step 4 surfaces the stderr and halts.

**Project root not found.** `findBookRoot` exits 2 with a `BibleError` on stderr when `.studio/meta.json` is not found at or above the current directory. The skill surfaces the error and notes that `.studio/meta.json` must be present at the project root.

**`install-statusline`: plugin root cannot be resolved.** Step A halts before any read or write; the skill names the settings.json and cache paths it attempted.

**`install-statusline`: existing `~/.claude/settings.json` is not valid JSON.** Step B halts before writing; the skill directs the author to fix or back up the file, or to use `/statusline` instead.

**`install-statusline`: no explicit yes (a no, silence, an unrelated answer, or a non-interactive context).** Step C or D writes nothing; the skill states that `/statusline` and re-running `install-statusline` both remain available.

## Worked Example

See [doctor.example.md](./doctor.example.md) for a condensed transcript of a `doctor report` session over the committed two-chapter sample book "The Quiet Network" (see `examples/sample-book/`). The example is grounded in a live `--report --json` run against the committed fixture that exited 0 with verdict `valid` and no findings, followed by a synthetic findings illustration using the engine's real finding-type strings.
