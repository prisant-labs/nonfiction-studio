# Planted Defect: Voice Drift (Register Shift in Chapter 2)

## Location

File: `chapters/02-finding-your-network.md`
Scope: entire chapter 2

## Register Changes

Chapter 2 has been rewritten from the golden book's active, second-person, direct-address register to a passive, impersonal third-person register. Specific changes applied throughout:

- All second-person address eliminated ("you", "your") and replaced with impersonal constructions ("one", "it is recommended", "a network should", etc.)
- All first-person pronouns eliminated ("I", "my") and replaced with impersonal constructions
- Active constructions replaced with passive voice ("It is recommended that one begin" instead of "Start with"; "should be resisted" instead of "Resist")
- Formal connectives introduced ("it is therefore advisable", "it follows that", "it is therefore recommended")
- Direct imperative sentences replaced with impersonal declarative equivalents

Chapter 1 is unchanged from the golden baseline.

All five claim markers (EV-0006 through EV-0010) are preserved on the same assertions they labeled in the golden book. No marker was moved, removed, or added.

## Marker Census

Golden chapter 2 markers: EV-0006, EV-0007, EV-0008, EV-0009, EV-0010 (5 markers)
Fixture chapter 2 markers: EV-0006, EV-0007, EV-0008, EV-0009, EV-0010 (5 markers)

Marker census: UNCHANGED. All 5 EV references remain on the same claims.

## Measurement Method

Method: word-tokenized prose from chapters/01 and chapters/02 combined; markdown headings and `[claim: EV-nnnn]` markers stripped. Canonical implementation: hooks/lib/stylometry-engine.mjs (TSK-026). Hyphenated compounds counted as single tokens. Sentence count from sentence-ending punctuation sequences.

Baseline values are the stored values in `.studio/config.json -> stylometry.baseline.markers`. Two baseline markers were updated during TSK-026 reconciliation (function_word_rate and punctuation_rate diverged beyond the 1% relative-deviation rounding rule). All numbers below reflect the reconciled baseline and the canonical engine measurements.

## Before/After Measurement Table (TSK-026 reconciled)

### Golden baseline: stored vs engine-measured (reconciliation)

| Marker | Stored (TSK-019) | Engine-measured | Relative deviation | Action |
|---|---|---|---|---|
| function_word_rate | 0.4501 | 0.4717 | 4.80% | UPDATED (>1% rule) |
| contraction_rate | 0.0299 | 0.0299 | 0.17% | stands |
| first_person_rate | 0.2268 | 0.2262 | 0.25% | stands |
| second_person_rate | 3.4014 | 3.3937 | 0.23% | stands |
| type_token_ratio | 0.4558 | 0.4536 | 0.48% | stands |
| avg_word_length | 5.2041 | 5.1923 | 0.23% | stands |
| avg_sentence_length | 13.1642 | 13.1940 | 0.23% | stands |
| punctuation_rate | 13.1519 | 13.0090 | 1.09% | UPDATED (>1% rule) |

Rounding rule: baseline stands when engine relative deviation is within 1.0%. Beyond 1.0%, engine value is canonical and baseline updated to 4 decimal places.

### Fixture vs reconciled baseline

| Marker | Reconciled baseline | Fixture measured | Absolute delta | Relative deviation | Flagged (>2%)? |
|---|---|---|---|---|---|
| function_word_rate | 0.4717 | 0.4754 | +0.0037 | +0.78% | no |
| contraction_rate | 0.0299 | 0.0448 | +0.0149 | +49.83% | YES |
| first_person_rate | 0.2268 | 0.0000 | -0.2268 | -100.0% | YES |
| second_person_rate | 3.4014 | 1.7486 | -1.6528 | -48.59% | YES |
| type_token_ratio | 0.4558 | 0.4536 | -0.0022 | -0.48% | no |
| avg_word_length | 5.2041 | 5.2284 | +0.0243 | +0.47% | no |
| avg_sentence_length | 13.1642 | 13.6567 | +0.4925 | +3.74% | YES |
| punctuation_rate | 13.0090 | 12.5683 | -0.4407 | -3.39% | YES |

Notes: first_person_rate drops from 0.2268 (2 instances in golden chapter 2) to 0.0000 in the rewritten fixture. second_person_rate drops because all second-person pronouns were removed from the rewritten chapter 2; the 16 remaining tokens come from the unchanged chapter 1. contraction_rate rises because the rewrite introduces "one's" possessive in chapter 2 (golden chapter 1 had "community's"; the fixture gains a second apostrophe token). function_word_rate deviation is 0.78%, below the 2% per-marker tolerance band: passive constructions add auxiliary function words ("is", "are", "should") but simultaneously remove first/second-person pronouns (also function words), leaving the net rate nearly unchanged relative to the reconciled baseline.

## Drift Score and Pinned Threshold

Drift score formula (TSK-022 documented, canonical): sum of |measured - baseline| / baseline * 100 across all 8 markers.

Marker contributions (reconciled):
- function_word_rate: 0.78 points
- contraction_rate: 49.83 points
- first_person_rate: 100.0 points
- second_person_rate: 48.59 points
- type_token_ratio: 0.48 points
- avg_word_length: 0.47 points
- avg_sentence_length: 3.74 points
- punctuation_rate: 3.39 points

Fixture drift score: 207.28

Golden book drift score: approximately 1.6 (all markers close to the reconciled baseline; well below threshold)

Pinned threshold (`thresholds.drift_score_max` in `.studio/config.json`): **20**

- Golden book drift (~1.6) is below the threshold (1.6 < 20): ns-stylometry passes the golden book
- Fixture drift (207.28) decisively exceeds the threshold
- Margin: 187.28 points above threshold (10x the threshold)

## Expected Engine Behavior

- `bin/ns-stylometry` exits 1. The drift score computed from the rewritten chapter 2 (207.28) exceeds `thresholds.drift_score_max` (20). Flagged markers: `contraction_rate`, `first_person_rate`, `second_person_rate`, `avg_sentence_length`, `punctuation_rate`. Note: `function_word_rate` is no longer flagged after reconciliation (0.78% deviation, within the 2% per-marker band); this is a documented reconciliation outcome from TSK-026, which supersedes the TSK-022 pre-engine expectation that `function_word_rate` would flag.

- All other CLIs exit 0. The claim markers are intact and resolve correctly (ns-claims exits 0). No continuity name mismatches were introduced (ns-scrub exits 0). No doctor anomalies beyond what the rewrite itself introduces (ns-doctor exits 0). No prompt-scrub violations (ns-probe exits 0).

## Changed-file Footprint

This fixture differs from the golden book in exactly four locations:

1. **chapters/02-finding-your-network.md** - Register rewrite from golden baseline (second-person active) to passive third-person impersonal.
2. **.studio/config.json** - `thresholds.drift_score_max` pinned to 20 only; `gate.checks.stylometry.mode` and `dod.require_drift_under_threshold` restored to their golden values. Mode toggles have no effect on exit codes: the ns-stylometry engine exits 1 on threshold exceedance per the S-07 (hooks and scripts) contract, regardless of gate mode. Gate mode governs only the gate's pass/fail decision.
3. **.studio/progress.json** - Word counts updated to 493 (chapter 2) and 913 (total) to match the rewritten chapter and maintain state coherence. The ns-doctor coherence check exits 0 here; the coherence anomaly detector lives in the unsourced-claim fixture.
4. **structure/chapter-list.md** - Chapter 2 word count (462 to 493) and total (882 to 913) kept coherent with progress.json.

(Footprint documented 2026-07-18 per the TSK-022 (voice-drift fixture) review adjudication.)
