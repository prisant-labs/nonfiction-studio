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

## Relationship to other CLIs

`ns-stylometry` shares the `countWords` tokenizer with `ns-doctor` (the single-tokenizer
authority per the 2026-07-18 banked adjudication). `bin/ns-gate` calls the stylometry
engine as the `stylometry` gate check. The `voice-capture` agent calls `ns-stylometry
--measure` to compute baseline vectors that are then written to `.studio/config.json`.

## See also

- [ns-gate CLI reference](./ns-gate.md) - orchestrator that calls ns-stylometry internally
- [capture-voice skill reference](../skills/capture-voice.md) - skill that builds the voice baseline
