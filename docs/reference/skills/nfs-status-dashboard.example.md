---
title: "nfs-status-dashboard worked example"
description: "Condensed transcript of a status-dashboard run over the committed two-chapter sample book The Quiet Network - shows the single bin/ns-status Bash call, JSON parse, table render, and next-actions list, grounded in a real CLI run"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "status", "dashboard", "progress", "overview", "gate", "example"]
---

# nfs-status-dashboard - worked example

This is a condensed transcript of a `status-dashboard` run over the committed two-chapter sample book "The Quiet Network" (see `examples/sample-book/`). The example follows the flow specified in S-06 3.9 (skills and invocation surface) and the adjudications recorded in TSK-052 (status-dashboard skill).

**Session provenance note.** This example is grounded in a live `--json` run executed 2026-08-15 against a scratch copy of the committed `examples/sample-book/` baseline, made outside the repository (this wave's discipline never runs a CLI against `examples/` in place, since the fixture suite asserts that tree stays byte-clean). The command, run after resolving the plugin root per Step 1 below, was `node "<plugin-root>/bin/ns-status" --project=. --json` from the book root; the scratch invocation used to produce the output below is equivalent. The JSON output is quoted verbatim, byte for byte, from that run. `bin/ns-status` is read-only; nothing under `.studio/` was written by generating this example, and the committed `examples/sample-book/` fixture itself was never touched.

Any scenario showing a highlighted row or a non-zero exit code is explicitly labeled as a synthetic illustration and does not reflect the committed fixture or the live run output.

---

## Setup: what was already in place

The committed `examples/sample-book/` baseline is a two-chapter bible for "The Quiet Network":

- `.studio/progress.json` - two chapters, both `status: drafted`; chapter 01 (`01-listening-before-speaking`) has `word_count: 528`, chapter 02 (`02-finding-your-network`) has `word_count: 527`; `totals.chapters_total: 6`.
- `.studio/config.json` - `thresholds.drift_score_max: 25`.
- `.studio/gate/` - one dot-form report, `01-listening-before-speaking.20260810T091000Z.json` (top-level `verdict: "pass"`), plus `last-gate.json`, which does not match either gate-report filename pattern and is not read by `bin/ns-status`. No `all.<timestamp>.json` whole-book report is present. Chapter 02 has no gate report on record.

Note: `progress.json`'s per-chapter `drift_score` field (`10.86` for chapter 01, `10.75` for chapter 02) is a hook-maintained convenience field, not the authoritative source for the Drift column - see "Key assertions" below for what the live run actually returned for chapter 02.

---

## Session: full status dashboard run

**Author:** `/nonfiction-studio:status-dashboard`

**Studio (Step 1 - Resolve the plugin root):**

The skill uses the Bash tool to look up the `nonfiction-studio` marketplace source path in `~/.claude/settings.json`. The primary lookup resolves the plugin's installed path on the first try; the plugins-cache and dev-mode fallbacks are not needed for this run. Continue to Step 2.

**Studio (Step 2 - Single Bash invocation):**

The skill uses the Bash tool (this is the one call for this invocation; no other tool call is made):

```
node "<plugin-root>/bin/ns-status" --project=. --json
```

**ns-status stdout (verbatim, exit code 0):**

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
      "gate": "pass",
      "reportPath": ".studio/gate/01-listening-before-speaking.20260810T091000Z.json",
      "highlighted": false
    },
    {
      "slug": "02-finding-your-network",
      "number": "02",
      "title": "Finding Your Network",
      "status": "drafted",
      "wordCount": 527,
      "openClaimCount": 0,
      "drift": null,
      "gate": null,
      "reportPath": null,
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
  "wholeBookGate": null,
  "thresholds": {
    "driftScoreMax": 25,
    "driftScoreMaxIsDefault": false
  }
}
```

ns-status exit code: 0. Parse stdout as the board JSON.

**Studio (Step 3 - Present the result, exit 0):**

Chapter rows, in array order from the JSON's `chapters` array:

- Chapter 01: `#` = `01` (`highlighted: false`, no `!` prefix), Title = `Listening Before Speaking`, Status = `drafted`, Words = `528`, Drift = `10.86`, Open Claims = `0`, Gate = `pass`.
- Chapter 02: `#` = `02`, Title = `Finding Your Network`, Status = `drafted`, Words = `527`, Drift = `-` (the `drift` field is `null`), Open Claims = `0`, Gate = `-` (the `gate` field is `null`).

Totals row from the JSON's `totals` object: Words = `1055`, Open Claims = `0`, Chapters final = `0 of 6 final` (`chaptersFinal: 0`, `chaptersTotal: 6`). The top-level `wholeBookGate` is `null`, so no whole-book annotation is appended.

**Studio:**

> | # | Title | Status | Words | Drift | Open Claims | Gate |
> |---|---|---|---|---|---|---|
> | 01 | Listening Before Speaking | drafted | 528 | 10.86 | 0 | pass |
> | 02 | Finding Your Network | drafted | 527 | - | 0 | - |
> | **Totals** | | | **1055** | | **0** | **0 of 6 final** |
>
> Drift threshold: `thresholds.drift_score_max` = `25` (from `.studio/config.json`).
>
> `6` chapter(s) remaining to final.
>
> No rows flagged.
>
> **Next actions:**
>
> - Chapter 02 (`02-finding-your-network`) has no gate report on record (`gate: null`). Run `/nonfiction-studio:run-quality-gate 02-finding-your-network` to gate this chapter.
> - No chapter has `openClaimCount` greater than 0.
> - No chapter has `highlighted: true`.

---

## Key assertions from this transcript

- **One Bash call, one parse, one render.** After resolving the plugin root in Step 1, the skill issued exactly one Bash call (`node "<plugin-root>/bin/ns-status" --project=. --json`), parsed its stdout as JSON, and read every table cell, the totals row, the footer, and the highlight decision directly from that JSON's fields. No directory listing, no separate file reads, no prose parsing, and no threshold comparison happen anywhere in this transcript.

- **`progress.json`'s per-chapter `drift_score` is not the Drift column's source, proven by real data in this run.** `progress.json` carries `drift_score: 10.75` for chapter 02, but the live run's JSON output returns `"drift": null` for that same chapter, because no gate report exists for it under `.studio/gate/`. `bin/ns-status` never treats `progress.json`'s `drift_score` field as authoritative; this transcript shows that rule holding against real, live output, not merely asserted in prose.

- **The highlight decision is read, not computed.** Both chapters carry `"highlighted": false` in the JSON. The skill applies the `!` prefix by reading that field directly; it never compares chapter 01's drift score of `10.86` against the threshold of `25` itself. See the synthetic illustration below for what a `highlighted: true` entry looks like and how the skill presents it.

- **The effective threshold is read, not assumed.** The footer's `25` comes from the JSON's `thresholds.driftScoreMax` field, and `driftScoreMaxIsDefault: false` tells the skill that value came from `.studio/config.json` rather than `bin/ns-status`'s own built-in default. The skill body names neither number.

- **`last-gate.json` is never read by the CLI or the skill.** It is present in `.studio/gate/` (see Setup above) but matches neither the per-chapter dot-form pattern nor the whole-book pattern `bin/ns-status` recognizes, so it plays no part in this output.

- **The skill writes nothing.** No file was created, modified, or appended at any step. `bin/ns-status` is read-only by design; `.studio/gate/01-listening-before-speaking.20260810T091000Z.json` and `progress.json` were read by the CLI but not written.

---

## Synthetic illustration: a highlighted row

The following is explicitly synthetic. It shows what the JSON and the rendered table would look like if chapter 02 had a gate report `bin/ns-status` flagged as highlighted:

**ns-status stdout (synthetic excerpt, chapter 02 only):**

```json
{
  "slug": "02-finding-your-network",
  "number": "02",
  "title": "Finding Your Network",
  "status": "drafted",
  "wordCount": 527,
  "openClaimCount": 3,
  "drift": 41,
  "gate": "warn",
  "reportPath": ".studio/gate/02-finding-your-network.20260815T090000Z.json",
  "highlighted": true
}
```

**Studio:**

> | # | Title | Status | Words | Drift | Open Claims | Gate |
> |---|---|---|---|---|---|---|
> | 01 | Listening Before Speaking | drafted | 528 | 10.86 | 0 | pass |
> | ! 02 | Finding Your Network | drafted | 527 | 41 | 3 | warn |
> | **Totals** | | | **1055** | | **3** | **0 of 6 final** |
>
> Drift threshold: `thresholds.drift_score_max` = `25` (from `.studio/config.json`).
>
> `6` chapter(s) remaining to final.
>
> Rows marked with a leading `!` were flagged by `bin/ns-status`.
>
> **Next actions:**
>
> - Chapter 02 (`02-finding-your-network`) has `openClaimCount: 3`. Run `/nonfiction-studio:fact-check-pass 02-finding-your-network` to resolve them.
> - Chapter 02 is highlighted (`gate` is `warn`, not `block`): `bin/ns-status` has already flagged its drift score as above the configured threshold. Run `/nonfiction-studio:draft-chapter 02-finding-your-network` to revise the chapter directly, then re-run `/nonfiction-studio:run-quality-gate 02-finding-your-network` to confirm the drift score has improved.

The `!` prefix comes directly from the synthetic entry's `"highlighted": true`; the skill never re-derives it from comparing `41` against `25` itself. This synthetic illustration does not reflect the committed fixture. The drift score of `41`, the `warn` verdict, the `3` open claims, and the `highlighted: true` flag are invented for illustration purposes only.

---

## Synthetic illustration: an engine error

The following is explicitly synthetic. It shows what Step 3 would present if `.studio/progress.json` were absent from an otherwise-initialized project.

**ns-status stderr (synthetic, exit code 2):**

```
ns-status: Cannot read progress.json at /path/to/project/.studio/progress.json: ENOENT: no such file or directory, open '/path/to/project/.studio/progress.json'
```

**Studio:**

> `.studio/progress.json` was not found. Run `/nonfiction-studio:init-project` to scaffold the project and create the progress file.

No table is rendered; the exit-2 case is never treated as a pass.
