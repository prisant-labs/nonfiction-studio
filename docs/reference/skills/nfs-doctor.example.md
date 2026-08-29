---
title: "nfs-doctor worked example"
description: "Condensed transcript of a doctor report session over the committed two-chapter sample book The Quiet Network - shows the single Bash call, exit-code mapping, clean-pass presentation, and a synthetic findings illustration using real engine finding-type strings"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "doctor", "integrity", "schema", "orphan", "example"]
---

# nfs-doctor - worked example

This is a condensed transcript of a `nfs-doctor report` session over the committed two-chapter sample book "The Quiet Network" (see `examples/sample-book/`). The example follows the flow specified in S-06 3.11 (skills and invocation surface) and the adjudications recorded in TSK-054 (doctor skill).

**Session provenance note.** This example is grounded in a live `report` run executed 2026-08-28 against the committed `examples/sample-book/` baseline (re-run to add the style-profile structure check, F-CI-08 (voice quality unchecked, deterministic half); the JSON output is unchanged byte-for-byte from the prior 2026-07-19 run: `examples/sample-book/context/style-profile.md` carried a stale `captured` timestamp against its own `config.json` before this branch, and was reconciled to agree with it as part of the same change that added the style-profile structure check, so the fixture was already clean by the time this check could run against it). The command, run after resolving the plugin root per Step 2 below, was `node "<plugin-root>/bin/ns-doctor" --project=examples/sample-book --report --json`; it exited 0 with `status: valid` and no findings. The JSON output is quoted verbatim. In a real book project the skill would run as `node "<plugin-root>/bin/ns-doctor" --project=. --report --json` from the book root; this is equivalent. The committed sample-book fixture is never modified by a doctor run; the engine is read-only per its READ-ONLY COVENANT.

Any scenario showing exit 1 findings is explicitly labeled as a synthetic illustration and does not reflect the committed fixture or the live run output.

---

## Setup: what was already in place

The committed `examples/sample-book/` baseline is a valid two-chapter bible for "The Quiet Network". Its `.studio/meta.json` has `schema_version: "2"` (the supported major). All scaffold-mandated paths are present: `.studio/progress.json`, `.studio/config.json`, `.studio/ai-use-log.jsonl`, `research/evidence-log.md`, `research/sources.md`, `context/style-profile.md`, `context/brief.md`, `structure/thesis.md`, and `structure/outline.md`.

The EV and SRC entries in the research files are well-formed; all chapter claim markers reference EV IDs present in the ledger; word counts in progress.json match the chapter files on disk; and no snapshot naming violations exist in `.studio/snapshots/`. The `config.json` `gate.checks.thesis_alignment.mode` is `warn`, so no config-coercion notice fires. `context/style-profile.md` carries all seven required sections in order, its `Baseline reference` block's `captured` and `sample_count` values agree with `config.json`'s `stylometry.baseline`, and its one `Exemplars` path resolves to a real file under `context/samples/`, so the style-profile structure check also passes clean.

---

## Session: full report run, clean bible

**Author:** `/nonfiction-studio:nfs-doctor`

**Studio (Step 1 - Argument parsing):**

No argument was supplied. Default mode is `report`. No tool call needed. Continue to Step 2.

**Studio (Step 2 - Resolve the plugin root):**

The skill uses the Bash tool to look up the `nonfiction-studio` marketplace source path in `~/.claude/settings.json`. The primary lookup resolves the plugin's installed path on the first try; the plugins-cache and dev-mode fallbacks are not needed for this run. Continue to Step 3.

**Studio (Step 3 - Single Bash invocation):**

The skill uses the Bash tool (this is the single doctor call; no sub-CLI calls are made):

```
node "<plugin-root>/bin/ns-doctor" --project=. --report --json
```

**Doctor stdout (verbatim, exit code 0):**

```json
{
  "check": "doctor",
  "schemaVersion": "2",
  "status": "valid",
  "findings": [],
  "notices": [],
  "migrationAvailable": false
}
```

Doctor exit code: 0. Parse stdout as JSON report. `status: valid`, zero findings.

**Studio (Step 4 - Present the result, exit 0):**

> Doctor verdict: PASS. Bible integrity check complete; no issues found.
>
> Schema version: 2. Checks run: bible structure, progress.json schema, meta.json and config.json shape, EV grammar, SRC grammar, orphan claim markers, orphan SRC references, word-count coherence, config-coercion notice, snapshot naming, style profile structure.
>
> The doctor wrote no files. All reads were against the committed bible tree.

---

## Key assertions from this transcript

- **Step 1 argument check is prose-only.** No tool call is needed to detect the mode or apply the default. The skill branches without accessing the file system.

- **ONE Bash call invokes the engine.** After resolving the plugin root in Step 2, the skill issued a single Bash call: `node "<plugin-root>/bin/ns-doctor" --project=. --report --json`. No individual calls to `bin/ns-claims`, `bin/ns-stylometry`, or `bin/ns-scrub` are made by the skill; the doctor engine runs its full check inventory internally via `runChecks`.

- **Exit 0 maps to a presented verdict, never silent.** The skill parsed stdout as JSON, confirmed `status: valid` and zero findings, and presented the full clean-pass message naming all eleven checks. A pass verdict is never silently swallowed.

- **The skill writes nothing in `report` mode, shown throughout this transcript.** No file was created, modified, or appended at any step. `bin/ns-doctor` and its engine are read-only without exception, in every mode. The skill itself has exactly one write path anywhere in the plugin: the `install-statusline` mode (not shown in this transcript), which writes `~/.claude/settings.json` and only that file, and only after the author answers an explicit yes to a stated consent prompt. See the [doctor skill reference](./nfs-doctor.md#install-statusline-mode) for that mode.

- **Notices would appear here if present.** The `notices` array is empty in this run. If `config.json` had `gate.checks.thesis_alignment.mode: "block"`, the engine would emit a `config-coercion.thesis-alignment` notice (informational, does not affect the exit code or verdict) and the skill would present it after the pass verdict.

---

## Synthetic illustration: what exit 1 findings look like

The following is explicitly a synthetic illustration. It does NOT reflect the committed sample-book fixture. It shows what Step 4 would report if the bible had three findings across three check groups.

**Doctor stdout (synthetic, exit code 1):**

```json
{
  "check": "doctor",
  "schemaVersion": "2",
  "status": "warnings",
  "findings": [
    {
      "type": "structure.missing-path",
      "path": "structure/outline.md",
      "message": "required bible path is absent: structure/outline.md"
    },
    {
      "type": "ev-grammar.malformed-entry",
      "path": "research/evidence-log.md#EV-0003",
      "message": "EV-0003: missing required field \"confidence\""
    },
    {
      "type": "claim-marker.orphan-ev",
      "path": "chapters/02-finding-your-network.md:14",
      "message": "chapter 02-finding-your-network.md line 14: [claim: EV-0099] references EV-0099 which is absent from research/evidence-log.md"
    }
  ],
  "notices": [],
  "migrationAvailable": false
}
```

**Studio (synthetic Step 4, exit 1):**

> **Bible structure: 1 finding**
> `structure/outline.md` [`structure.missing-path`]: required bible path is absent: structure/outline.md
> Missing scaffold paths. Suggested next step: re-run `/nonfiction-studio:nfs-new-book` to re-stamp missing paths (idempotent for existing content), or create the named path manually.
>
> **Evidence log grammar: 1 finding**
> `research/evidence-log.md#EV-0003` [`ev-grammar.malformed-entry`]: EV-0003: missing required field "confidence"
> Edit `research/evidence-log.md` to correct the named entry: add missing required fields, fix confidence or status enum values, or correct the SRC ID format.
>
> **Orphan claim markers: 1 finding**
> `chapters/02-finding-your-network.md:14` [`claim-marker.orphan-ev`]: chapter 02-finding-your-network.md line 14: [claim: EV-0099] references EV-0099 which is absent from research/evidence-log.md
> Run `/nonfiction-studio:nfs-fact-check 02-finding-your-network` to reconcile chapter markers and the evidence ledger.
>
> Doctor verdict: 3 total finding(s). Address the items above, then re-run `/nonfiction-studio:nfs-doctor` to confirm the bible is clean.

This synthetic illustration uses the real finding-type strings (`structure.missing-path`, `ev-grammar.malformed-entry`, `claim-marker.orphan-ev`) from the doctor engine. No findings of any kind exist in the committed `examples/sample-book/` fixture.

---

## Synthetic illustration: migrate mode output

The following is explicitly synthetic. It shows what Step 4 would present for each of the two migrate-mode cases.

**Current schema, nothing to migrate (exit 0; stdout JSON, `"status": "current"`):**

> Doctor migrate verdict: Schema version is current. No migration is needed. nothing to migrate, schema is current (schema_version "2"); migrations arrive with the first schema change per Q-04 (release, versioning, and compatibility). No files were written. Migrations arrive with the first schema change per Q-04 (release, versioning, and compatibility); the snapshot-before-migrate and restore-on-failure contract activates at that time.

**Migration required (exit 2; stderr content, `schema_version: "1"`):**

> Doctor migrate verdict: Migration required. bible schema version "1" requires migration to supported major "2"; run ns-doctor --migrate to apply the migration. No migration has been applied; migrations from older schema versions are not yet defined in v1. The snapshot-before-migrate and restore-on-failure contract activates when real migrations arrive per Q-04 (release, versioning, and compatibility). No files were written. Verify the `schema_version` field in `.studio/meta.json`; the supported major is `2`.

The `--migrate` flag exits 0 for the current-schema case and 2 for the migration-required case. Neither case writes any file; the migrate mode in v1 is diagnose-only.

---

## Synthetic illustration: fix mode decline

**Author:** `/nonfiction-studio:nfs-doctor fix`

**Studio (Step 1 - fix decline):**

> The `fix` mode is Phase 2+ scope and is not available in v1. No changes have been made to any file. When `fix` arrives in Phase 2 its contract will be: dry-run default, explicit `apply` argument required to commit changes, fixable-issue list includes duplicate EV IDs, malformed JSONL log lines, and broken internal cross-references, and each change is logged to `.studio/logs/doctor-<ts>.json`. To diagnose issues without repairing them, run `/nonfiction-studio:nfs-doctor` (no argument) to run the full check inventory in report mode.

No tool call is made. The skill halts at Step 1 without invoking the engine or reading any file.
