---
title: "status-dashboard worked example"
description: "Condensed transcript of a status-dashboard run over the committed two-chapter sample book The Quiet Network - shows the progress.json read, gate directory listing, per-slug report parsing, table render, threshold evaluation, and next-actions list"
audience: "non-engineer"
level: "beginner"
tags: ["skill", "status", "dashboard", "progress", "overview", "gate", "example"]
---

# status-dashboard - worked example

This is a condensed transcript of a `status-dashboard` run over the committed two-chapter sample book "The Quiet Network" (see `examples/sample-book/`). The example follows the flow specified in S-06 3.9 (skills and invocation surface) and the adjudications recorded in TSK-052 (status-dashboard skill).

**Session provenance note.** All values in the rendered table are read directly from the committed fixture at `examples/sample-book/`. The files involved are:

- `examples/sample-book/.studio/progress.json` - two chapters with reconciled word counts and open-claim totals
- `examples/sample-book/.studio/config.json` - `thresholds.drift_score_max: 35`
- `examples/sample-book/.studio/gate/01-listening-before-speaking.20260718T090000Z.json` - the one committed gate report; top-level `verdict: pass`, `stylometry` detail `"drift_score 0 is within threshold 35"`

The dashboard is rendered as the skill would produce it from these files; no live gate run is performed and no files are written. Any scenario showing a `block` verdict, a highlighted row, or a non-zero open-claim count is explicitly synthetic and does not reflect the committed fixture.

---

## Setup: what was already in place

**`.studio/progress.json`** (committed, quoted in full):

```json
{
  "version": 2,
  "updated": "2026-07-18T09:05:00Z",
  "chapters": [
    {
      "slug": "01-listening-before-speaking",
      "title": "Listening Before Speaking",
      "status": "drafted",
      "word_count": 422,
      "drift_score": 0,
      "open_claim_count": 0,
      "last_gate": {
        "ts": "2026-07-18T09:00:00Z",
        "verdict": "pass",
        "report": ".studio/gate/01-listening-before-speaking.20260718T090000Z.json"
      }
    },
    {
      "slug": "02-finding-your-network",
      "title": "Finding Your Network",
      "status": "drafted",
      "word_count": 462,
      "drift_score": 0,
      "open_claim_count": 0,
      "last_gate": null
    }
  ],
  "totals": {
    "word_count": 884,
    "open_claim_count": 0,
    "chapters_final": 0,
    "chapters_total": 6
  }
}
```

Note: `progress.last_gate` is reserved and unpopulated in v1 per TSK-051 (run-quality-gate skill). The skill reads the gate directory directly and never reads `last_gate` from this file.

**`.studio/gate/` directory** (committed filenames):
- `01-listening-before-speaking.20260718T090000Z.json` - dot-form report for chapter 01
- `last-gate.json` - does not match the dot-form pattern; the skill ignores it

**`.studio/config.json`** (relevant field):
- `thresholds.drift_score_max: 35`

---

## Session: full status dashboard run

**Author:** `/nonfiction-studio:status-dashboard`

**Studio (Step 1 - Progress.json presence and validity check):**

The skill uses the Bash tool:

```
test -f .studio/progress.json && echo HAS_PROGRESS || echo NO_PROGRESS
```

Output: `HAS_PROGRESS`

The skill uses the Read tool on `.studio/progress.json`. Parse confirms: `version: 2`, `chapters` array with 2 entries, `totals` object with `word_count`, `open_claim_count`, `chapters_final`. Each chapter entry carries `slug`, `status`, `word_count`, and `open_claim_count`. Validation passes. Continue to Step 2.

**Studio (Step 2 - Gate directory listing and per-slug report identification):**

The skill uses the Bash tool:

```
test -d .studio/gate && ls .studio/gate/ 2>/dev/null || echo NO_GATE_DIR
```

Output:
```
01-listening-before-speaking.20260718T090000Z.json
last-gate.json
```

Parse filenames:

- `01-listening-before-speaking.20260718T090000Z.json` matches the dot-form pattern `<slug>.<YYYYMMDDTHHMMSSZ>.json`. Slug: `01-listening-before-speaking`. This is the only report for this slug, so it is the newest.
- `last-gate.json` does not match either pattern. Ignored.
- No `all.<ts>.json` files found. No whole-book annotation for the totals row.

Chapter `02-finding-your-network` has no matching gate file. Its Drift and Gate cells will be "-".

The skill uses the Read tool on `.studio/gate/01-listening-before-speaking.20260718T090000Z.json`. Relevant fields from the report:

- Top-level `verdict`: `"pass"` - this is the Gate cell for chapter 01.
- `stylometry` check entry: `"detail": "drift_score 0 is within threshold 35"` - parsing the numeric value yields `0`. This is the Drift cell for chapter 01.

**Studio (Step 3 - Config read for drift threshold):**

The skill uses the Read tool on `.studio/config.json`. `thresholds.drift_score_max` is `35`. Config value applied; no default needed.

**Studio (Step 4 - Render the dashboard table):**

Chapter rows, in array order from `progress.json.chapters`:

- Chapter 01: # = `01`, Title = `Listening Before Speaking` (from `title` field), Status = `drafted`, Words = `422`, Drift = `0` (from gate report stylometry detail), Open Claims = `0`, Gate = `pass` (from gate report top-level verdict).
- Chapter 02: # = `02`, Title = `Finding Your Network` (from `title` field), Status = `drafted`, Words = `462`, Drift = `-` (no gate report), Open Claims = `0`, Gate = `-` (no gate report).

Totals row from `progress.json.totals`: Words = `884`, Open Claims = `0`, Chapters final = `0 of 6`. No whole-book all-report found; no gate annotation on the totals row.

**Studio:**

> | # | Title | Status | Words | Drift | Open Claims | Gate |
> |---|---|---|---|---|---|---|
> | 01 | Listening Before Speaking | drafted | 422 | 0 | 0 | pass |
> | 02 | Finding Your Network | drafted | 462 | - | 0 | - |
> | **Totals** | | | **884** | | **0** | **0 of 6 final** |
>
> Drift threshold: `thresholds.drift_score_max` = `35` (from `.studio/config.json`).
>
> No rows flagged.
>
> **Next actions:**
>
> - Chapter 02 (`02-finding-your-network`) has no gate report on record. Run `/nonfiction-studio:run-quality-gate 02-finding-your-network` to gate this chapter.
> - No chapters have open claims.
> - No rows are highlighted for drift or a block verdict.

---

## Key assertions from this transcript

- **Progress.json is the sole source for status, word count, and open claims.** The Drift and Gate columns come from the gate report; the other four chapter columns come from `progress.json`. The `drift_score` field inside `progress.json` (which is `0` for both chapters) is never read by the dashboard; that field is a hook-maintained convenience, not the authoritative source for the dashboard column.

- **`progress.last_gate` is never read.** Chapter 01 has a `last_gate` object in `progress.json`, but the skill ignores it entirely. The gate directory listing is the sole discovery mechanism for gate reports.

- **`last-gate.json` is ignored.** That file does not match the dot-form pattern `<slug>.<YYYYMMDDTHHMMSSZ>.json` or the whole-book pattern `all.<YYYYMMDDTHHMMSSZ>.json`. The skill silently excludes it from consideration.

- **Drift is parsed from the gate report, not stored separately.** The drift score of `0` for chapter 01 comes from parsing the `stylometry` check `detail` string in `.studio/gate/01-listening-before-speaking.20260718T090000Z.json`, not from `progress.json.chapters[0].drift_score`.

- **Chapter 02 shows "-" in Drift and Gate because no gate report file exists for it.** The `last_gate: null` in `progress.json` for chapter 02 is consistent with this, but the null value is not the signal the skill reads; the absence of a matching file in `.studio/gate/` is.

- **Threshold evaluation uses the config value.** The threshold is `35` from `.studio/config.json`. Chapter 01's drift of `0` is below `35`; chapter 02 has no drift value. No rows are flagged.

- **The skill writes nothing.** No file was created, modified, or appended at any step. The gate report was read but not written; `progress.json` was read but not written.

- **One Read call per gate report.** The skill issued one Read call for the single matching gate report (`01-listening-before-speaking.20260718T090000Z.json`). If multiple chapters had gate reports, each would require exactly one Read call for its newest report.

---

## Synthetic illustration: highlighted rows

The following is explicitly synthetic. It shows what the table would look like if chapter 02 had a gate report with drift above the threshold or a block verdict:

> | # | Title | Status | Words | Drift | Open Claims | Gate |
> |---|---|---|---|---|---|---|
> | 01 | Listening Before Speaking | drafted | 422 | 0 | 0 | pass |
> | ! 02 | Finding Your Network | drafted | 462 | 41 | 3 | warn |
> | **Totals** | | | **884** | | **3** | **0 of 6 final** |
>
> Drift threshold: `thresholds.drift_score_max` = `35` (from `.studio/config.json`).
>
> Row 02 is flagged: drift `41` exceeds threshold `35`.
>
> **Next actions:**
>
> - Chapter 02 drift `41` exceeds threshold `35`: run `/nonfiction-studio:revise-pass 02-finding-your-network` to address voice drift, then re-run `/nonfiction-studio:run-quality-gate 02-finding-your-network`.
> - Chapter 02 has `3` open claims: run `/nonfiction-studio:fact-check-pass 02-finding-your-network` to resolve them.

This synthetic illustration does not reflect the committed fixture. The drift score of `41`, the warn verdict, and the `3` open claims are invented for illustration purposes only.
