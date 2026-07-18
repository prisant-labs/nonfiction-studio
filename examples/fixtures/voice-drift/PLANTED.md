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

Method: word-tokenized prose from chapters/01 and chapters/02 combined; markdown headings and `[claim: EV-nnnn]` markers stripped. Measurement script: scratchpad/measure-stylometry.mjs (implements the TSK-019 golden-book method).

Baseline values are the stored values in `.studio/config.json -> stylometry.baseline.markers` (captured 2026-07-18 by the TSK-019 implementer). The drift comparison uses the stored baseline as the authoritative reference, not a remeasured approximation.

## Before/After Measurement Table

| Marker | Golden baseline (stored) | Fixture measured | Absolute delta | Relative deviation |
|---|---|---|---|---|
| function_word_rate | 0.4501 | 0.4710 | +0.0209 | +4.64% |
| first_person_rate (per 100 words) | 0.2268 | 0.0000 | -0.2268 | -100.0% |
| second_person_rate (per 100 words) | 3.4014 | 1.7486 | -1.6528 | -48.6% |
| type_token_ratio | 0.4558 | 0.4536 | -0.0022 | -0.5% |
| avg_word_length (chars) | 5.2041 | 5.2284 | +0.0243 | +0.5% |
| avg_sentence_length (words) | 13.1642 | 13.6567 | +0.4925 | +3.7% |
| punctuation_rate (per 100 words) | 13.1519 | 13.7705 | +0.6186 | +4.7% |

Note: first_person_count drops from 2 (both "I" and "my" in golden chapter 2) to 0 in the rewritten chapter. function_word_rate rises because passive constructions add auxiliary verbs ("is", "are", "should", "ought", "be", "been") at higher density. second_person_rate drops because all 14 second-person tokens from the original chapter 2 are removed; the 16 remaining second-person tokens in the fixture come entirely from the unchanged chapter 1.

## Drift Score and Pinned Threshold

Drift score formula (to be implemented by ns-stylometry): sum of |measured - baseline| / baseline * 100 for all markers where baseline > 0.

Two named markers contribute:
- function_word_rate: 4.64 points
- first_person_rate: 100.0 points
- second_person_rate: 48.6 points (not a named trigger, but contributes to the aggregate score)

Fixture drift score (named markers only): 104.6
Fixture drift score (all significant markers): approximately 157

Golden book drift score from its own baseline: 0 (the baseline IS the golden book)

Pinned threshold (`thresholds.drift_score_max` in `.studio/config.json`): **20**

- Golden book drift (0) is below the threshold (0 < 20): ns-stylometry passes the golden book
- Fixture drift (approximately 157 for full aggregate, minimum 104.6 for named markers alone) decisively exceeds the threshold
- Margin: at least 84.6 points above threshold (minimum 4x the threshold)

## Expected Engine Behavior

- `bin/ns-stylometry` exits 1. The drift score computed from the rewritten chapter 2 exceeds `thresholds.drift_score_max` (20). Per-marker flags include `function_word_rate` (measured 0.4710 vs baseline 0.4501, +4.64% outside 2% tolerance band) and `first_person_rate` (measured 0.0000 vs baseline 0.2268, outside any reasonable tolerance). The stylometry check is configured in `block` mode in this fixture's `.studio/config.json`.

- All other CLIs exit 0. The claim markers are intact and resolve correctly (ns-claims exits 0). No continuity name mismatches were introduced (ns-scrub exits 0). No doctor anomalies beyond what the rewrite itself introduces (ns-doctor exits 0). No prompt-scrub violations (ns-probe exits 0).

## Changed-file Footprint

This fixture differs from the golden book in exactly four locations:

1. **chapters/02-finding-your-network.md** - Register rewrite from golden baseline (second-person active) to passive third-person impersonal.
2. **.studio/config.json** - `thresholds.drift_score_max` pinned to 20 only; `gate.checks.stylometry.mode` and `dod.require_drift_under_threshold` restored to their golden values. Mode toggles have no effect on exit codes: the ns-stylometry engine exits 1 on threshold exceedance per the S-07 (hooks and scripts) contract, regardless of gate mode. Gate mode governs only the gate's pass/fail decision.
3. **.studio/progress.json** - Word counts updated to 493 (chapter 2) and 913 (total) to match the rewritten chapter and maintain state coherence. The ns-doctor coherence check exits 0 here; the coherence anomaly detector lives in the unsourced-claim fixture.
4. **structure/chapter-list.md** - Chapter 2 word count (462 to 493) and total (882 to 913) kept coherent with progress.json.

(Footprint documented 2026-07-18 per the TSK-022 (voice-drift fixture) review adjudication.)
