---
title: "ns-stylometry CLI reference"
description: "Reference for the ns-stylometry CLI - voice-drift detection engine"
audience: "non-engineer"
level: "beginner"
tags: ["cli", "stylometry", "voice", "drift", "baseline"]
---

# ns-stylometry

Measures an eight-marker stylometric vector for each chapter and computes the aggregate
drift score against the captured author baseline. Exits 0 when the drift score is below
the configured threshold; exits 1 when the threshold is exceeded; exits 2 on missing
baseline, argument error, or operational failure.

## Purpose

`ns-stylometry` is the voice-drift engine per D-08 (hybrid voice scoring) and S-07
(hooks and scripts). It reads the author's baseline vector from `.studio/config.json`
(or a `--baseline` override) and measures the current chapters against it using eight
markers: function-word rate, contraction rate, first-person rate, second-person rate,
type-token ratio, average word length, average sentence length, and punctuation rate.
The drift score is an unweighted sum of per-marker deviations: every marker counts
equally, none is weighted more heavily than another. Each marker's CONTRIBUTION to
that sum is capped at one third of the configured drift budget (`thresholds.drift_score_max`),
so no single unstable marker can push the score to the threshold on its own; at least
three markers have to deviate substantially before their combined contribution can
breach the gate. The cap only bounds what a marker contributes to the score -- the
per-marker `deviationPct` reported in the output is always the honest, uncapped
number, and each entry also reports whether the cap was binding for that marker.
Markers that deviate beyond the per-marker tolerance are flagged individually in the
output (flagging uses the honest deviation, not the capped contribution).

The `voice-drift` fixture is designed so the passive impersonal register that replaces
first-person and second-person address moves several markers at once: first-person rate
drops to zero, second-person rate and contraction rate shift sharply, and sentence
rhythm changes measurably. No single one of these markers can exceed the drift score's
threshold alone, per the per-marker contribution cap described above; it is their
combined contribution, several markers deviating together, that pushes the fixture's
drift score past its threshold of 20, per the 2026-07-18 reconciliation at TSK-026
(ns-stylometry engine).

## Invocation

```
ns-stylometry [--chapter=<slug>] [--all] [--baseline=<path>] [--measure=<path>[,<path>...]] [--project=<dir>] [--json]
```

## Windows invocation

Bare `ns-stylometry` invocation fails in the Bash tool on Windows; the plugin
system does not add `bin/` to PATH (ADR-0005, bin PATH on Windows). Hook, skill,
and agent contexts must resolve the plugin root first, then invoke:

```
node "<plugin-root>/bin/ns-stylometry" [--chapter=<slug>] [--all] [--baseline=<path>] [--measure=<path>[,<path>...]] [--project=<dir>] [--json]
```

where `<plugin-root>` is the resolved plugin installation path. Direct
interactive invocation from a user's own shell can add `bin/` to PATH manually,
or use the same `node` plus full-path form.

## Flags

| Flag | Type | Description |
|---|---|---|
| `--chapter=<slug>` | string | Measure a single chapter file. |
| `--all` | boolean | Measure all `.md` files in `chapters/` (default). |
| `--baseline=<path>` | string | Override the baseline source. Accepts a config-shaped object with `stylometry.baseline.markers`, a bare baseline object (`markers` plus `marker_set_version`), or a raw flat markers object. A raw flat markers object carries no `marker_set_version`, so it is treated as version 1 and rejected by the stale-baseline guard below, the same as an old config.json baseline. |
| `--measure=<path>[,<path>...]` | list | Measure mode: compute and print the raw vector for the given files without consulting a baseline; JSON output only; exits 0. Used by `voice-capture` to build a new baseline. |
| `--project=<dir>` | string | Override the book root to `<dir>`. |
| `--json` | boolean | Emit the full drift report as JSON to stdout. |

## Exit taxonomy

| Exit code | Meaning |
|---|---|
| 0 | Pass - drift score is below the `thresholds.drift_score_max` value in config.json (default 25) |
| 1 | Drift score at or above threshold; per-marker flags identify which markers drove the score |
| 2 | Missing baseline, stale baseline (`marker_set_version` does not match the engine's current version -- run `capture-voice` to recapture it), missing chapters directory, invalid `--measure` argument, or operational error |

## Output

Human-readable pass:

```
[stylometry] pass: drift score 2.34 < threshold 25
```

Human-readable failure:

```
[stylometry] drift score 28.41 exceeds threshold 20
  [first_person_rate] deviation 87.32% (baseline=0.2262 measured=0.0289)
```

JSON output (with `--json`) follows the S-08 drift-report shape with `verdict`, `driftScore`,
`threshold`, `markers` (per-marker baseline/measured/deviationPct/capped/flagged), `chapters`,
`findings`, and `ts` fields. `capped` records whether the per-marker contribution bound was
binding for that marker; `deviationPct` is always the honest, uncapped number regardless.

## Eight-marker vector

| Marker | Description |
|---|---|
| `function_word_rate` | Proportion of tokens that are function words (articles, prepositions, conjunctions) |
| `contraction_rate` | Proportion of SENTENCES that contain a contraction or apostrophe-bonded possessive (contractions divided by sentence count, not by token count) |
| `first_person_rate` | First-person pronouns (I, me, my, myself, we, us, our...) per hundred words |
| `second_person_rate` | Second-person pronouns (you, your, yourself...) per hundred words |
| `type_token_ratio` | Moving-average type-token ratio: the mean of the plain unique/total ratio over every sliding 100-token window, which makes it length-invariant by construction. Text shorter than or equal to one window falls back to the plain ratio over the whole text. |
| `avg_word_length` | Mean character length of all word tokens (no content-word filter -- function words are included) |
| `avg_sentence_length` | Mean word count per sentence |
| `punctuation_rate` | Punctuation characters per hundred words |

## Example invocations

Run against all chapters in the current project:

```
ns-stylometry --json
```

Test the voice-drift fixture (should exit 1):

```
ns-stylometry --project=examples/fixtures/voice-drift
```

Measure a chapter's raw vector for baseline capture:

```
ns-stylometry --measure=chapters/01-listening-before-speaking.md,chapters/02-finding-your-network.md
```

## Per-chapter drift versus the book-level baseline

The Stop gate's per-chapter stylometry check compares ONE chapter's marker vector against
the book-level baseline stored in `.studio/config.json`. That baseline is fit to the
combined word-population of every chapter sampled when it was captured, so a single
chapter is being measured against a population it only partially represents. Before the
roadmap row 1.7 (voice registers) correction, this structurally inflated `type_token_ratio`
in particular: the marker's old definition, unique words divided by total words, falls
monotonically as text grows, so a short single-chapter sample always read as more lexically
varied than a larger combined baseline expected, and that gap showed up as drift the
chapter did not actually introduce.

`type_token_ratio` is now a moving average over 100-token windows rather than a flat ratio
(see the eight-marker table above), which is length-invariant by construction: the window
never changes size no matter how much text is measured, so a short chapter and a longer
book-level baseline are compared on the same footing. The shipped sample book makes the
correction concrete. Its baseline (`.studio/config.json` `stylometry.baseline.markers`) is
captured from `chapters/01-listening-before-speaking.md` and `chapters/02-finding-your-network.md`
combined, after both chapters were rewritten for voice consistency, so it is still a fit
against itself rather than an independent sample -- book-level drift against it measures
near zero either way. What changed is the per-chapter reading: measured individually,
chapter 1's `type_token_ratio` is now 0.7498 and chapter 2's is 0.7490, against 0.7329 for
the two combined -- a residual gap of about two percent, not the roughly nine-percentage-point
gap (0.5057 versus 0.4171) the flat ratio produced. Chapter 1's per-chapter drift score fell
from 29.80 (of a 35 budget, `type_token_ratio` alone contributing 21.24 of those points) to
10.86, with `type_token_ratio` now contributing 2.30 points. The residual gap is not zero --
a very short chapter still carries some sample-size noise, and text shorter than one window
falls back to the plain ratio entirely -- but it no longer dominates the score. That 35-budget
figure is historical: the default budget was itself recalibrated to 25 afterward, for the
reasons in Calibration, below. Chapter 1's score of 10.86 did not change (`drift_score_max`
does not affect the score, only the pass/block line), so it now reads as 43.4% of a smaller
budget rather than 31% of the original one.

The per-marker contribution cap (see Purpose, above) addresses the other half of the same
roadmap row: a marker whose baseline rests on very few raw occurrences, such as
`first_person_rate` on a short sample, could swing by a large relative percentage from a
one- or two-token difference and consume the entire drift budget by itself. Capping each
marker's contribution at one third of the budget means at least three markers now have to
deviate substantially before their combined contribution can breach the gate, so a single
unstable marker can no longer manufacture a false positive on its own -- while a chapter
that has genuinely drifted, which moves several markers at once, still clears the threshold
comfortably (the planted `voice-drift` fixture still exceeds its threshold at book level and
for every chapter individually after both corrections).

## Calibration

`thresholds.drift_score_max` defaults to 25 (`DEFAULT_DRIFT_SCORE_MAX` in
`hooks/lib/stylometry-engine.mjs`, the single source of truth every other module and CLI
that needs the default imports rather than re-declaring). It was 35 until this recalibration.

**Why it changed.** The `type_token_ratio` length-invariance correction described above
shrank the drift score's overall scale by roughly an order of magnitude without a matching
change to the budget. Measured against a committed, labeled scenario suite (`tests/engines/
fixtures/drift-scenarios/`, exercised by `tests/engines/stylometry-calibration.test.mjs`), a
chapter with every contraction and every first-person pronoun stripped out -- the canonical
signature of a ghostwriting pass, mechanically removing the author's voice rather than a
human revising it -- passed at the 35 default. That scenario blocks at the 25 default.

**What was measured, not just argued.** Three levers were evaluated against the suite:
lowering the default budget (selected); lowering the per-marker contribution divisor
(rejected: the ghostwriting scenario's score and the natural-variation-between-chapters
score move together as the divisor changes, so no divisor value separates them, and a
smaller divisor also erodes the "at least three markers must move together" guarantee the
cap exists to provide); and damping the per-marker cap by the raw occurrence count each
marker rests on (rejected: the ghostwriting signature lives on the two sparsest markers in
the vector, so damping by occurrence count makes that specific signature score LOWER, moving
it further from blocking, not closer -- the opposite of what the regression needed). The
full scenario table, the swept budget values considered, and the reasoning for each rejected
lever are recorded in the task history for this change.

**What this calibration cannot do.** Two honestly written chapters from the same author,
scored against a baseline self-fit from just those two chapters, differ from each other on
the same three markers the ghostwriting signature moves (contraction, first-person, and
second-person rate), because a two-chapter self-fit baseline is each chapter's own
population as much as it is a population either chapter was independently measured against.
No budget or divisor value found by this task passes that honest variation while still
blocking the ghostwriting signature above -- the two cases land on the same side of every
threshold tested, for the same structural reason (both are dominated by two or three markers
pinned at the per-marker bound plus the population floor). This is a property of scoring a
short chapter against a same-book self-fit baseline, not a defect in the 25 default
specifically; a baseline captured from independent author writing samples, at enough volume
to stop being dominated by a handful of pronoun and contraction counts, is the fix, and is
out of scope for this change.

## Relationship to other CLIs

`ns-stylometry` shares the `countWords` tokenizer with `ns-doctor` (the single-tokenizer
authority per the 2026-07-18 banked adjudication). `bin/ns-gate` calls the stylometry
engine as the `stylometry` gate check. The `voice-capture` agent calls `ns-stylometry
--measure` to compute baseline vectors that are then written to `.studio/config.json`.

## See also

- [ns-gate CLI reference](./ns-gate.md) - orchestrator that calls ns-stylometry internally
- [capture-voice skill reference](../skills/capture-voice.md) - skill that builds the voice baseline
