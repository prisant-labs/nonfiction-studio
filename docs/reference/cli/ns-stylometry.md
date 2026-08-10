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
The drift score is a weighted combination of per-marker deviations. Markers that
deviate beyond the per-marker tolerance are flagged individually in the output.

The `voice-drift` fixture is designed so the first-person rate drops sharply (passive
impersonal register replacing first-person address), causing the drift score to exceed
the fixture's threshold of 20, per the 2026-07-18 reconciliation at TSK-026
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
| `--baseline=<path>` | string | Override the baseline source. Accepts a JSON file containing a raw markers object or a config-shaped object with `stylometry.baseline.markers`. |
| `--measure=<path>[,<path>...]` | list | Measure mode: compute and print the raw vector for the given files without consulting a baseline; JSON output only; exits 0. Used by `voice-capture` to build a new baseline. |
| `--project=<dir>` | string | Override the book root to `<dir>`. |
| `--json` | boolean | Emit the full drift report as JSON to stdout. |

## Exit taxonomy

| Exit code | Meaning |
|---|---|
| 0 | Pass - drift score is below the `thresholds.drift_score_max` value in config.json (default 35) |
| 1 | Drift score at or above threshold; per-marker flags identify which markers drove the score |
| 2 | Missing baseline, missing chapters directory, invalid `--measure` argument, or operational error |

## Output

Human-readable pass:

```
[stylometry] pass: drift score 2.34 < threshold 35
```

Human-readable failure:

```
[stylometry] drift score 28.41 exceeds threshold 20
  [first_person_rate] deviation 87.32% (baseline=0.2268 measured=0.0289)
```

JSON output (with `--json`) follows the S-08 drift-report shape with `verdict`, `driftScore`,
`threshold`, `markers` (per-marker baseline/measured/deviationPct/flagged), `chapters`,
`findings`, and `ts` fields.

## Eight-marker vector

| Marker | Description |
|---|---|
| `function_word_rate` | Proportion of tokens that are function words (articles, prepositions, conjunctions) |
| `contraction_rate` | Proportion of tokens that are contractions |
| `first_person_rate` | Proportion of tokens that are first-person pronouns (I, me, my, myself) |
| `second_person_rate` | Proportion of tokens per 1000 words that are second-person (you, your, yourself) |
| `type_token_ratio` | Ratio of unique word types to total tokens (vocabulary richness) |
| `avg_word_length` | Mean character length of content words |
| `avg_sentence_length` | Mean word count per sentence |
| `punctuation_rate` | Punctuation characters per 1000 words |

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

The Stop gate's per-chapter stylometry check (roadmap row 1.7, voice registers) compares
ONE chapter's marker vector against the book-level baseline stored in `.studio/config.json`.
That baseline is fit to the combined word-population of every chapter sampled when it was
captured, so a single chapter is being measured against a population it only partially
represents. This structurally inflates `type_token_ratio` in particular: vocabulary
repeats less over a short single-chapter sample than it does once the chapter is folded
into a larger combined text, so a chapter measured alone reads as more lexically varied
than the baseline expects, and that gap shows up as drift the chapter did not actually
introduce.

The shipped sample book makes this concrete rather than theoretical. Its baseline (`.studio/config.json`
`stylometry.baseline.markers`) was captured from `chapters/01-listening-before-speaking.md`
and `chapters/02-finding-your-network.md` combined, after both chapters were rewritten for
voice consistency. That makes the baseline a fit against itself, not an independent
measurement: book-level drift against it measures 0.02, near zero, because the population
being measured and the population defining the baseline are the same two chapters. Measured
individually, chapter 1's `type_token_ratio` is 0.5057 and chapter 2's is 0.4934, against
0.4171 for the two combined; that gap alone accounts for the majority of chapter 1's 29.80
per-chapter drift score (of a 35 budget). Both facts are disclosed in the `method` field
of the baseline itself.

This is stated plainly, not as a defect verdict: the per-chapter check still runs and still
provides real regression protection (a chapter that drifts from the shipped voice registers
a check would still flag), and the number it produces is a legitimate reading of a
self-derived baseline compared against a smaller population, not a wrong number. Correcting
the underlying metric so a single chapter can be scored without the sample-size penalty, and
reducing the sample book's own prose padding to buy back headroom, are both scheduled as
tranche 2 work against roadmap row 1.7 (voice registers); they are not done here.

## Relationship to other CLIs

`ns-stylometry` shares the `countWords` tokenizer with `ns-doctor` (the single-tokenizer
authority per the 2026-07-18 banked adjudication). `bin/ns-gate` calls the stylometry
engine as the `stylometry` gate check. The `voice-capture` agent calls `ns-stylometry
--measure` to compute baseline vectors that are then written to `.studio/config.json`.

## See also

- [ns-gate CLI reference](./ns-gate.md) - orchestrator that calls ns-stylometry internally
- [capture-voice skill reference](../skills/capture-voice.md) - skill that builds the voice baseline
