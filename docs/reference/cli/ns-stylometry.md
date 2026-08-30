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

The flag output above states the score but not why it is what it is: with eight markers
each capped independently, a score can be dominated by a bound the reader cannot see, and
a marker can deviate enormously while contributing a fixed, much smaller amount. `--explain`
renders the same data computeDrift already computes -- every marker's baseline, measured
value, honest deviation, and actual contribution, plus whether the per-marker bound was
binding for it and whether it crossed the per-marker tolerance band -- ordered by
contribution descending, so the marker that drove the verdict is named first. See Output,
below, for real examples.

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
ns-stylometry [--chapter=<slug>] [--all] [--baseline=<path>] [--measure=<path>[,<path>...]] [--project=<dir>] [--json] [--explain]
```

## Windows invocation

Bare `ns-stylometry` invocation fails in the Bash tool on Windows; the plugin
system does not add `bin/` to PATH (ADR-0005, bin PATH on Windows). Hook, skill,
and agent contexts must resolve the plugin root first, then invoke:

```
node "<plugin-root>/bin/ns-stylometry" [--chapter=<slug>] [--all] [--baseline=<path>] [--measure=<path>[,<path>...]] [--project=<dir>] [--json] [--explain]
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
| `--explain` | boolean | Render every marker's baseline, measured value, honest deviation, actual contribution, whether the per-marker bound was binding, and whether it crossed the per-marker tolerance band, ordered by contribution descending. Composes with both the human-readable and `--json` modes (see Output, below) rather than replacing either one; writes nothing to disk. |

## Exit taxonomy

| Exit code | Meaning |
|---|---|
| 0 | Pass - drift score is below the `thresholds.drift_score_max` value in config.json (default 25) |
| 1 | Drift score at or above threshold; per-marker flags identify which markers drove the score |
| 2 | Missing baseline, stale baseline (`marker_set_version` does not match the engine's current version -- run `nfs-capture-voice` to recapture it), missing chapters directory, invalid `--measure` argument, or operational error |

`--explain` never changes this taxonomy: it only adds detail to whichever exit code the run
already produces. A run with `--explain` and the same run without it always exit with the
same code for the same input, including on the exit-2 operational-error paths, where
`--explain` is never reached at all.

## Output

Human-readable pass:

```
[stylometry] pass: drift score 2.34 < threshold 25
```

Human-readable failure (`ns-stylometry --all` against the `voice-drift` fixture; pasted from
the same real run as the `--explain` example below, so the two are directly comparable):

```
[stylometry] drift score 28.49 exceeds threshold 20
  [contraction_rate] deviation 49.75% (baseline=0.0299 measured=0.0448)
  [first_person_rate] deviation 100.00% (baseline=0.2262 measured=0.0000)
  [second_person_rate] deviation 48.47% (baseline=3.3937 measured=1.7486)
  [avg_sentence_length] deviation 3.51% (baseline=13.1940 measured=13.6567)
  [punctuation_rate] deviation 3.39% (baseline=13.0090 measured=12.5683)
```

JSON output (with `--json`) follows the S-08 drift-report shape with `verdict`, `driftScore`,
`threshold`, `markers` (per-marker baseline/measured/deviationPct/capped/flagged), `chapters`,
`findings`, and `ts` fields. `capped` records whether the per-marker contribution bound was
binding for that marker; `deviationPct` is always the honest, uncapped number regardless.
A consumer who never passes `--explain` sees exactly this shape, unchanged -- no `explain`
key is present at all, not an empty or null one.

### `--explain` output

`--explain` composes with both the human-readable and `--json` modes rather than replacing
either one, and never changes the exit code. It writes nothing to disk. The two real runs
below are pasted verbatim from a scratch copy of the shipped fixtures, not hand-authored.

Human-readable, a passing chapter (`ns-stylometry --chapter=01-listening-before-speaking
--explain` against the sample book's own chapter 1, no marker capped at this budget):

```
[stylometry] pass: drift score 10.86 < threshold 25
Top driver: second_person_rate, contributing 6.57

Markers ranked by contribution to the score (largest first); * marks a marker whose honest deviation crosses the 2.00% per-marker tolerance band:
* second_person_rate   contribution   6.57  deviation    6.57%  baseline 2.8436  measured 3.0303  bound not binding
* type_token_ratio     contribution   2.30  deviation    2.30%  baseline 0.7329  measured 0.7498  bound not binding
  avg_word_length      contribution   1.02  deviation    1.02%  baseline 5.0095  measured 4.9583  bound not binding
  function_word_rate   contribution   0.69  deviation    0.69%  baseline 0.4882  measured 0.4848  bound not binding
  first_person_rate    contribution   0.10  deviation    0.10%  baseline 0.7583  measured 0.7576  bound not binding
  avg_sentence_length  contribution   0.09  deviation    0.09%  baseline 13.1875  measured 13.2000  bound not binding
  punctuation_rate     contribution   0.09  deviation    0.09%  baseline 13.2701  measured 13.2576  bound not binding
  contraction_rate     contribution   0.00  deviation    0.00%  baseline 0.1250  measured 0.1250  bound not binding
```

`second_person_rate` and `type_token_ratio` are marked because their honest deviation crosses
the tolerance band even though neither is capped; the other six markers stay under it.

Human-readable, a blocking book (`ns-stylometry --all --explain` against the `voice-drift`
fixture, three markers pinned at the per-marker bound):

```
[stylometry] drift score 28.49 exceeds threshold 20
Top driver: contraction_rate, contributing 6.67 (bound was binding; honest deviation is 49.75%)

Markers ranked by contribution to the score (largest first); * marks a marker whose honest deviation crosses the 2.00% per-marker tolerance band:
* contraction_rate     contribution   6.67  deviation   49.75%  baseline 0.0299  measured 0.0448  bound was binding (max 6.67)
* first_person_rate    contribution   6.67  deviation  100.00%  baseline 0.2262  measured 0.0000  bound was binding (max 6.67)
* second_person_rate   contribution   6.67  deviation   48.47%  baseline 3.3937  measured 1.7486  bound was binding (max 6.67)
* avg_sentence_length  contribution   3.51  deviation    3.51%  baseline 13.1940  measured 13.6567  bound not binding
* punctuation_rate     contribution   3.39  deviation    3.39%  baseline 13.0090  measured 12.5683  bound not binding
  function_word_rate   contribution   0.79  deviation    0.79%  baseline 0.4717  measured 0.4754  bound not binding
  avg_word_length      contribution   0.70  deviation    0.70%  baseline 5.1923  measured 5.2284  bound not binding
  type_token_ratio     contribution   0.11  deviation    0.11%  baseline 0.7516  measured 0.7525  bound not binding
```

`first_person_rate` is the clearest case of the opacity this flag exists to close: its
honest deviation is 100.00%, but the bound (one third of this fixture's 20-point budget,
6.67) is binding, so it contributes the same 6.67 points as the other two capped markers --
a fact the pre-`--explain` output never stated, leaving a reader to notice it only by
comparing two numbers that disagree. The `*` mark is a separate, independent signal from
`bound was binding`: `avg_sentence_length` and `punctuation_rate` are marked (their deviation
crosses the 2.00% tolerance band) without being capped, and a marker can in principle be capped
without being marked, if a future project configures a tolerance band wider than its
contribution bound.

With `--json --explain` together, the JSON output above gains one additional top-level key,
`explain`, positioned after `markers`:

```json
"explain": {
  "budget": 20,
  "maxMarkerContribution": 6.666666666666667,
  "markerTolerance": 2,
  "perMarker": [
    {
      "marker": "contraction_rate",
      "baseline": 0.0299,
      "measured": 0.04477611940298507,
      "deviationPct": 49.75290770229122,
      "contribution": 6.666666666666667,
      "capped": true,
      "flagged": true
    }
  ]
}
```

`budget` is the same value as the top-level `threshold` field, repeated here so the explain
block is self-contained. `maxMarkerContribution` is the per-marker bound in absolute terms
(`budget` divided by the engine's internal divisor, currently 3 -- read from the engine's
own computation, never a literal in the CLI). `markerTolerance` is the per-marker tolerance
band `flagged` is computed against (`thresholds.stylometry_marker_tolerance`, default 2.0 -
also read from the engine's own computation, included here for the same reason as
`maxMarkerContribution`: so a consumer can state the number a boolean was compared against,
not just the boolean itself). `perMarker` carries every marker from `markers` again, this
time ordered by `contribution` descending and including `contribution` itself, which the
plain `markers` object does not.

When there are no chapters to scan, there is no measured vector and nothing to rank.
`--explain` states that rather than staying silent, matching how this CLI already speaks
(not silently) in the same branch without the flag:

```
[stylometry] pass: no chapters to scan
  no chapters to scan; nothing to explain
```

and, with `--json --explain` together, `explain.perMarker` is an empty array and
`explain.note` carries the same stated reason as a string.

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
lowering the default budget (selected); lowering the per-marker contribution divisor; and
damping the per-marker cap by the raw occurrence count each marker rests on. Damping by raw
occurrence count was rejected outright: the ghostwriting signature lives on the two sparsest
markers in the vector, so damping by occurrence count makes that specific signature score
LOWER, moving it further from blocking, not closer -- the opposite of what the regression
needed, at every damping strength tried.

Lowering the divisor is a more qualified rejection, corrected after an initial version of
this document overstated it. AT A FIXED BUDGET, the ghostwriting signature and natural
between-chapter voice variation move together as the divisor changes -- both are dominated by
two markers pinned at the per-marker bound plus a residual, and neither budget 35 nor budget
25 has a divisor that separates them. That is not the same claim as "no divisor separates
them," and the stronger claim is false: separation exists in the JOINT budget-and-divisor
space. Natural voice variation's score has a hard ceiling (the largest measured chapter tops
out at 47.09 once the per-marker cap exceeds that chapter's own largest single deviation,
16.49%), while the ghostwriting signature's two fully-saturated markers keep climbing
linearly with the cap and have no such ceiling below 210. Once the budget exceeds the honest-
variation ceiling, the two curves cross. A working point was verified end to end against the
real engine: budget 50, divisor 2.5 blocks the ghostwriting signature (score 50.24) while
passing both de-padded golden chapters (47.09 and 44.54) and matching every other scenario's
ground truth, with two markers alone (40) still comfortably short of the 50-point budget --
the "at least three markers" guarantee holds outright there, not just in spirit.

That point was not adopted as the shipped default. The feasible region shrinks fast as the
divisor rises toward the current value of 3 (a few points wide near divisor 2.5 in this
task's own search, and empty by divisor 2.6), the low end of the feasible divisor range sits
close enough to 2 that two markers alone approach sufficiency to block by themselves --
eroding, not preserving, the guarantee the bound exists to provide -- and any divisor change
ripples into every document and fixture that quotes "one third" or a divisor-derived number,
including `examples/fixtures/voice-drift/PLANTED.md`'s per-marker contribution table. Nothing
about the shipped default requires this region to stay unexplored forever; it is simply a
larger change than this task made, evaluated and left for a future task with the numbers
above to start from, not because the numbers do not exist.

**What actually makes the ghostwriting signature block at the shipped default.** Decomposed
against chapter 1's own true baseline (removing the same-book population-mismatch floor
entirely), the ghostwriting signature's genuine knock-on in the six markers the
transformation does not directly touch is about 6.05 points -- short of the roughly 8.33
points that budget 25's cap of 8.33 per marker would need from residual alone to block. The
remaining roughly 4.2 points of the 10.25-point residual actually measured (against the real,
same-book self-fit baseline) come from the same population-mismatch floor every chapter
carries when scored against that kind of baseline (10.86 points, for a chapter that was not
transformed at all). At the shipped default, the calibration catches the ghostwriting
signature partly because of that floor, not from the transformation's own signal alone. A
baseline with less population mismatch -- more author samples, not just the two chapters
being graded -- would shrink the floor and, with it, part of what currently makes 25 work.

**What this calibration cannot do at the shipped default (divisor 3, budget 25).** Two
honestly written chapters from the same author, scored against a baseline self-fit from just
those two chapters, differ from each other on the same three markers the ghostwriting
signature moves (contraction, first-person, and second-person rate), because a two-chapter
self-fit baseline is each chapter's own population as much as it is a population either
chapter was independently measured against. At divisor 3 specifically, no budget in the
range this calibration could responsibly ship passes that honest variation while still
blocking the ghostwriting signature (see the joint-space paragraph above for where that stops
being true). This is a property of scoring a short chapter against a same-book self-fit
baseline at this divisor, not an unconditional impossibility.

A baseline captured from independent author writing samples, at enough volume to stop being
dominated by a handful of pronoun and contraction counts, would also shrink the honest-
variation problem -- but per the paragraph above, that same volume shrinks the population-
mismatch floor this calibration partly relies on to catch the ghostwriting signature. Moving
to an independent-sample baseline is not a strict improvement over the two-chapter self-fit
baseline this document otherwise describes; it trades one open problem for tightening the
margin on another, already-fixed one. Building that baseline, and re-deriving the budget
against it, is out of scope for this change.

**The scenario suite alone does not select 25.** At divisor 3, the eight non-honest-variation
scenarios in the suite are consistent with any budget from about 16.12 to 30.73 -- a band
roughly 14.6 points wide. 25 was chosen inside that band for the margins described above, not
derived uniquely from the scenarios. The suite's own floor-fraction test (asserting 10.86 is
43.4% of budget) narrows the pin further, but that test is a statistic computed FROM the
chosen value, not an independent ground-truth constraint the way the scenario verdicts are;
it pins drift away from 25, it does not justify 25 over some other point in the 14.6-point
band.

## Relationship to other CLIs

`ns-stylometry` shares the `countWords` tokenizer with `ns-doctor` (the single-tokenizer
authority per the 2026-07-18 banked adjudication). `bin/ns-gate` calls the stylometry
engine as the `stylometry` gate check. The `voice-capture` agent calls `ns-stylometry
--measure` to compute baseline vectors that are then written to `.studio/config.json`.

## See also

- [ns-gate CLI reference](./ns-gate.md) - orchestrator that calls ns-stylometry internally
- [nfs-capture-voice skill reference](../skills/nfs-capture-voice.md) - skill that builds the voice baseline
