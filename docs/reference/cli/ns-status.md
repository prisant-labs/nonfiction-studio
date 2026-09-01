---
title: "ns-status CLI reference"
description: "Reference for the ns-status CLI - the deterministic engine that computes the project's chapter board and completion numbers from progress.json, config.json, and the newest gate report per chapter"
audience: "non-engineer"
level: "beginner"
tags: ["cli", "status", "dashboard", "progress", "gate", "drift"]
---

# ns-status

Computes the project's chapter board and completion numbers - per-chapter status, word count,
open claims, drift score, and gate verdict, plus whole-book totals - from committed state, and
renders the result as JSON or as a human-readable Markdown board. Read-only: it writes nothing.
Running it twice against unchanged state produces byte-identical output.

## Purpose

Before this CLI existed, the `nfs-status-dashboard` skill computed the same numbers by asking the
language model to list the `.studio/gate/` directory, parse filenames, open reports, and read
numbers out of prose by eye - with nothing asserting it parsed correctly the same way twice.
`ns-status` is the deterministic replacement computation: a later task points that skill at this
CLI's own JSON output instead. This passes [ADR-0009](../../adr/ADR-0009-apparatus-cli.md)
(apparatus CLI)'s growth-policy criterion 1: correctness here is a byte-for-byte, machine-checkable
property that a failing test can be written against before the feature exists, the same criterion
`ns-notes` passed.

`ns-status` is read-only by design. It never writes to `.studio/` or anywhere else. State
changes (the promotion ceremony onto the existing `final` chapter status, for example - see
["The promotion ceremony and automatic demotion"](#the-promotion-ceremony-and-automatic-demotion)
below) belong to a hook, because D-06 (single-writer state discipline) reserves `.studio/`
machine-state writes for hooks, not for a CLI a narrating skill can invoke mid-conversation.

## What it reads

| Path | Fields |
|---|---|
| `.studio/progress.json` | Per-chapter `slug`, `title`, `status`, `word_count`, `open_claim_count`; whole-book `totals` (`word_count`, `open_claim_count`, `chapters_final`, `chapters_total`) |
| `.studio/gate/` (directory listing, then the newest report per chapter slug) | Gate verdict, drift statistic, and drift threshold per chapter |

**Gate verdict, drift statistic, and drift threshold come only from the newest report file per
chapter slug under `.studio/gate/`, never from `progress.json`'s per-chapter `last_gate` field,
never from `progress.json`'s per-chapter `drift_score` field, and (since ADR-0012, voice verdict
scope, Decision 2) never from `.studio/config.json`'s retired `thresholds.drift_score_max`
either.** `last_gate` stays null in every shipped writer by design (the field is reserved for a
later task); a hand-authored fixture may populate it for one chapter as sample content, which
does not make it a real source. `drift_score` is a separate, hook-maintained convenience field
this board never treats as authoritative. The newest report per slug is selected by
lexicographic sort of the compact `YYYYMMDDTHHMMSSZ` timestamp suffix in its filename
(`<slug>.<timestamp>.json`), which equals chronological order by construction - the same rule
`hooks/lib/gate-engine.mjs`'s own report retention and `skills/nfs-status-dashboard/SKILL.md`
both already use. A whole-book `all.<timestamp>.json` report, if present, annotates the totals
only (`wholeBookGate`), not any per-chapter cell.

## Invocation

```
ns-status [--project=<dir>] [--json]
```

## Windows invocation

Bare `ns-status` invocation fails in the Bash tool on Windows; the plugin system does not add
`bin/` to PATH (ADR-0005, bin PATH on Windows). Hook, skill, and agent contexts must resolve the
plugin root first, then invoke:

```
node "<plugin-root>/bin/ns-status" [--project=<dir>] [--json]
```

where `<plugin-root>` is the resolved plugin installation path.

## Flags

| Flag | Type | Description |
|---|---|---|
| `--project=<dir>` | string | Override the book root to `<dir>`. If omitted, the tool walks up from the current directory looking for `.studio/meta.json`. |
| `--json` | boolean | Emit the board as JSON to stdout instead of the human-readable Markdown board. |

## Exit taxonomy

| Exit code | Meaning |
|---|---|
| 0 | Success. There is no findings-based exit code: a highlighted row (drift above ITS OWN row's threshold, or a block verdict) is reported in the board, not signaled through the exit code, because `ns-status` reports state - it does not gate anything. |
| 2 | An argument error (an unknown flag, a flag missing its required value), no book root found walking up from the start directory, or an unreadable/malformed `.studio/progress.json` or `.studio/config.json`. Every exit-2 message is prefixed `ns-status: `. |

## Output

### Human-readable board (default)

A Markdown table with columns `#`, `Title`, `Status`, `Words`, `Drift`, `Threshold`, `Open
Claims`, `Gate`, one row per `progress.json` chapter entry in array order, followed by a
**Totals** row. A highlighted row (drift statistic above THAT SAME row's own threshold, or a
`block` gate verdict) carries a leading `!` in its `#` cell. A chapter with no gate report on
record shows `-` in the Drift, Threshold, and Gate cells. Since ADR-0012 (voice verdict scope,
Decision 2) retired `thresholds.drift_score_max`, there is no board-wide threshold to state
below the table: each row's own Threshold cell comes from that SAME chapter's own report,
resolved from its calibration ladder at whatever word count it measured. Below the table, when
`progress.json`'s totals carry a `chapters_total`, a chapters-remaining-to-final count.

Example, against the committed sample book (chapter 01's `Threshold` cell reads `-` here because
its committed report predates the structured `drift` field; Task 5, ADR-0012 implementation
wave, recaptures this fixture):

```
| # | Title | Status | Words | Drift | Threshold | Open Claims | Gate |
|---|---|---|---|---|---|---|---|
| 01 | Listening Before Speaking | drafted | 528 | 10.86 | - | 0 | pass |
| 02 | Finding Your Network | drafted | 527 | - | - | 0 | - |
| **Totals** | | | **1055** | | | **0** | **0 of 6 final** |

6 chapter(s) remaining to final.
```

### JSON (`--json`)

```json
{
  "chapters": [
    {
      "slug": "01-listening-before-speaking",
      "number": "01",
      "title": "Listening Before Speaking",
      "status": "drafted",
      "wordCount": 528,
      "openClaimCount": 0,
      "drift": 10.86,
      "threshold": null,
      "gate": "pass",
      "reportPath": ".studio/gate/01-listening-before-speaking.20260810T091000Z.json",
      "highlighted": false
    }
  ],
  "totals": {
    "wordCount": 1055,
    "openClaimCount": 0,
    "chaptersFinal": 0,
    "chaptersTotal": 6,
    "chaptersRemaining": 6
  },
  "wholeBookGate": null
}
```

`reportPath` is always book-root-relative (for example `.studio/gate/<slug>.<timestamp>.json`),
never an absolute filesystem path, and is `null` when the chapter has no gate report on record.
`drift` is the row's own chapter's newest report's drift statistic: it prefers the structured
`drift.statistic` field (PF-14, ADR-0012 voice verdict scope, Decision 2) and falls back to
parsing the legacy prose detail string for a report written before that field existed; `threshold`
is that SAME report's `drift.threshold`, with no prose fallback (a pre-structured-field report,
like the committed example above, reads `null` even though its prose names a number). There is
no top-level `thresholds` object any more: `thresholds.drift_score_max` was retired by ADR-0012
(voice verdict scope, Decision 2), and no single board-wide threshold replaced it. `chaptersTotal`
and `chaptersRemaining` are both `null` when `progress.json`'s totals carry no `chapters_total`
field. This JSON shape is the source a later task points the `nfs-status-dashboard` skill's
narration at.

## Determinism

Running `ns-status` twice against unchanged project state produces byte-identical output, in
either mode: no generation timestamp is stamped into the output, no number is formatted with a
locale-aware method (`toLocaleString` or `Intl.NumberFormat`, both of which vary by OS locale), and
every path emitted is book-root-relative. This follows `ns-statusline`'s own established
convention, for the same reason: this repository's CI runs both an Ubuntu and a Windows leg, and
the two must agree byte for byte.

## The promotion ceremony and automatic demotion

`ns-status` reports the `final` status; it never sets it. Reaching `final` - the terminal state
on the schema's `status` enum (`empty`, `outlined`, `drafting`, `drafted`, `revised`, `gated`,
`final`) - requires a dated human attestation entry in `context/decisions.md`
([format reference](../../formats/decisions.md)): `actor: author` exactly (not a roster slug),
all required fields present, and a `links` entry naming the chapter's slug. Some planning prose
for this project calls this same terminal state "locked"; there is no separate `locked` value on
the enum - it is `final` under a different name, reused rather than adding an eighth schema value
for a rename that would force a version bump and a migration.

Promotion is a human editing `.studio/progress.json` directly, in a batch that does not also
write the chapter's own file (see below for why). Demotion is automatic and machine-enforced:
`hooks/post-tool-batch.mjs`, `.studio/progress.json`'s sole writer per D-06 (single-writer state
discipline), falls a chapter back to `revised` whenever either holds:

- the chapter reads `final` but no valid attestation names its slug - an unattested promotion
  attempt never takes effect; it is reverted in the same batch it happened in, even when no
  chapter file was written at all, or
- the chapter's own file is written (`Write` or `Edit`) while it is `final` - regardless of
  whether the new content differs from the old, and regardless of whether a matching attestation
  still exists. Any further edit invalidates the prior sign-off: the attestation grammar carries
  no content fingerprint that could tell a genuine revert apart from a coincidence, so the hook
  does not try to guess.

Because the hook demotes on any edit to the chapter's own file, a batch that both edits the
chapter and sets it `final` in `.studio/progress.json` is demoted by the edit half before the
promotion can stand - the attestation must land in its own batch.

The eligibility check - `isEligibleForFinal` in `hooks/lib/status-engine.mjs` - is the one
implementation shared between the hook and this module, so the two cannot disagree about what
"eligible" means. `ns-status` itself never calls it: this CLI stays read-only (see Purpose above)
and trusts `progress.json`'s `status` field verbatim, which the hook has already made
trustworthy by construction before this CLI ever reads it.

## Vocabulary note

This CLI reports project progress and how many chapters remain to reach `final`. It never uses the
tier-climb term `scripts/tier-report.mjs` reserves for a different concept entirely (this plugin's
own self-sufficiency tier climb): the two are unrelated ideas that happen to both describe
"distance to a goal," so this CLI's vocabulary is deliberately kept to "progress" and "remaining."

## Relationship to other CLIs

`ns-status` is the eighth CLI shipped under `bin/` (D-05, five shipped CLIs, grown by one per each
of `ns-statusline`, `ns-notes`, and now `ns-status`; see
[ADR-0009](../../adr/ADR-0009-apparatus-cli.md) for the growth-policy test). It reads the same
`.studio/gate/` report shape [`ns-gate`](./ns-gate.md) writes
([gate report format](../../formats/gate-report.md)), but never runs `ns-gate` itself: `ns-status`
only ever reads reports already on disk, the same performance boundary
[`ns-statusline`](./ns-statusline.md) draws against `.studio/gate/last-gate.json`. Unlike
`ns-statusline`, which is a fail-safe status-bar renderer that always exits 0 and never writes to
stderr, `ns-status` follows this plugin's ordinary CLI exit taxonomy (0 or 2, with the CLI's own
name in every error message), because it has a real operator - a skill or an author - that can act
on a non-zero exit.

## See also

- [ns-gate CLI reference](./ns-gate.md) - writes the per-chapter and whole-book reports this CLI reads
- [ns-statusline CLI reference](./ns-statusline.md) - the always-succeeding status-bar sibling this CLI's exit taxonomy deliberately diverges from, and why
- [gate report format](../../formats/gate-report.md) - the normative shape of the files under `.studio/gate/`
- [decision log format](../../formats/decisions.md) - the normative grammar for `context/decisions.md`, including the promotion attestation shape the ceremony above requires
- [ADR-0009: apparatus CLI](../../adr/ADR-0009-apparatus-cli.md) - the standing growth-policy test this CLI passes
