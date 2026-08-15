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

Method: word-tokenized prose from chapters/01 and chapters/02 combined; markdown headings and `[claim: EV-nnnn]` markers stripped. Canonical implementation: hooks/lib/stylometry-engine.mjs (TSK-026, as corrected 2026-08-15 per roadmap row 1.7, voice registers). Hyphenated compounds counted as single tokens. Sentence count from sentence-ending punctuation sequences.

Baseline values are the stored values in `.studio/config.json -> stylometry.baseline.markers`, re-captured 2026-08-15 under the corrected engine. The baseline is measured from the TSK-019 golden two-chapter text as originally committed, not from this fixture's own chapter 2, because chapter 2 carries the planted defect this fixture exists to demonstrate; scoring against a baseline built from the drifted text would trivially erase the drift the fixture is designed to catch. All numbers below reflect this recaptured baseline and the corrected engine's measurements.

Two corrections landed together in this recapture (roadmap row 1.7, voice registers): `type_token_ratio` is now a moving average over 100-token windows rather than a flat unique/total ratio, which is length-invariant by construction; and no single marker's contribution to the drift score may exceed one third of the configured budget, so a marker with an extreme relative deviation (`first_person_rate` and `contraction_rate` below, both near or at 100%) can no longer single-handedly decide the verdict. The recapture also superseded the manual TSK-026 rounding-rule reconciliation for the other seven markers with a direct engine measurement of the same golden text, which moves a few of them by a fraction of a percentage point (see the baseline table below); it does not change any of this fixture's conclusions.

## Before/After Measurement Table (roadmap row 1.7 correction, corrected 2026-08-15)

### Baseline: before this correction vs after

| Marker | Baseline before | Baseline after | What changed |
|---|---|---|---|
| function_word_rate | 0.4717 | 0.4717 | unchanged |
| contraction_rate | 0.0299 | 0.0299 | unchanged |
| first_person_rate | 0.2268 | 0.2262 | direct recapture supersedes TSK-026 "stands" rounding |
| second_person_rate | 3.4014 | 3.3937 | direct recapture supersedes TSK-026 "stands" rounding |
| type_token_ratio | 0.4558 | 0.7516 | Correction A: flat ratio to moving-average |
| avg_word_length | 5.2041 | 5.1923 | direct recapture supersedes TSK-026 "stands" rounding |
| avg_sentence_length | 13.1642 | 13.1940 | direct recapture supersedes TSK-026 "stands" rounding |
| punctuation_rate | 13.0090 | 13.0090 | unchanged |

### Fixture vs corrected baseline, book level (chapters 01 and 02 combined)

| Marker | Baseline | Measured | deviationPct (honest) | Capped? | Contribution to score |
|---|---|---|---|---|---|
| function_word_rate | 0.4717 | 0.4754 | 0.79% | no | 0.79 |
| contraction_rate | 0.0299 | 0.0448 | 49.75% | YES | 6.67 |
| first_person_rate | 0.2262 | 0.0000 | 100.00% | YES | 6.67 |
| second_person_rate | 3.3937 | 1.7486 | 48.47% | YES | 6.67 |
| type_token_ratio | 0.7516 | 0.7525 | 0.11% | no | 0.11 |
| avg_word_length | 5.1923 | 5.2284 | 0.70% | no | 0.70 |
| avg_sentence_length | 13.1940 | 13.6567 | 3.51% | no | 3.51 |
| punctuation_rate | 13.0090 | 12.5683 | 3.39% | no | 3.39 |

Book-level drift score: 28.49 (sum of the Contribution column). Budget is 20, so the per-marker cap (one third of budget) is 6.67; three markers hit it. `deviationPct` stays the honest, uncapped number in every case -- `first_person_rate` still reports exactly 100%, not 6.67% -- only its contribution to the running score total is bounded.

Notes: `first_person_rate` drops to 0.0000 because all first-person pronouns were removed from the rewritten chapter 2. `second_person_rate` drops because all second-person pronouns were removed from the rewritten chapter 2; the 16 remaining tokens come from the unchanged chapter 1. `contraction_rate` rises because the rewrite introduces "one's" possessive in chapter 2 (golden chapter 1 had "community's"; the fixture gains a second apostrophe token). `function_word_rate` deviation is 0.79%, below the 2% per-marker tolerance band: passive constructions add auxiliary function words ("is", "are", "should") but simultaneously remove first/second-person pronouns (also function words), leaving the net rate nearly unchanged relative to the baseline. `type_token_ratio` deviation is now 0.11% (was 0.48% under the flat ratio) -- the moving-average correction leaves this marker's already-small deviation just as small, because the length-invariance fix targets the artifact from comparing populations of different SIZES, not this fixture's genuine register shift, which barely moves vocabulary variety either way.

### Fixture vs corrected baseline, per chapter

The per-chapter reading is the criterion that distinguishes a corrected metric from a disabled one: the fixture must still exceed its threshold not only in aggregate but for every chapter measured individually against the same book-level baseline.

| Chapter | Drift score | Threshold | Exceeds? | Markers capped at the bound |
|---|---|---|---|---|
| 01-listening-before-speaking (unchanged from golden) | 26.66 | 20 | YES | contraction_rate, first_person_rate, second_person_rate |
| 02-finding-your-network (the planted rewrite) | 33.60 | 20 | YES | first_person_rate, second_person_rate, avg_sentence_length |

Chapter 1 is unchanged prose (see Register Changes, above) and still exceeds the threshold on its own: chapter 1's `contraction_rate`, `first_person_rate`, and `second_person_rate` are measured against the same book-level baseline that includes chapter 2's contribution, so chapter 1 alone reads as a deviation from a population it is only half of -- the same book-versus-chapter population mismatch documented in `docs/reference/cli/ns-stylometry.md`, distinct from this fixture's planted register shift. This is expected and does not weaken the fixture: chapter 2, which carries the actual planted defect, exceeds by a wider margin (33.60 versus 26.66).

## Drift Score and Pinned Threshold

Drift score formula (TSK-022 documented, as amended by roadmap row 1.7's per-marker contribution cap): sum, across all 8 markers, of each marker's deviationPct capped at one third of the configured drift budget.

Fixture drift score: 28.49 (book level), 26.66 (chapter 1 alone), 33.60 (chapter 2 alone).

Golden book drift score: 0.01 (book level; all markers close to the self-referential baseline, well below threshold). See `docs/reference/cli/ns-stylometry.md` for the golden book's own per-chapter reading, which also improved under this correction (chapter 1 fell from 29.80 to 10.86 of a 35 budget).

Pinned threshold (`thresholds.drift_score_max` in `.studio/config.json`): **20**

- Golden book drift (0.01) is below the threshold: ns-stylometry passes the golden book
- Fixture drift exceeds the threshold at book level (28.49) and for every chapter individually (26.66, 33.60)
- Book-level margin: 8.49 points above threshold

## Expected Engine Behavior

- `bin/ns-stylometry` exits 1 for `--all` (drift score 28.49 exceeds `thresholds.drift_score_max` 20) and for `--chapter=<slug>` on EVERY chapter (26.66 and 33.60, both exceeding 20). Flagged markers at book level: `contraction_rate`, `first_person_rate`, `second_person_rate`, `avg_sentence_length`, `punctuation_rate`. `function_word_rate` is not flagged at book level (0.79% deviation, within the 2% per-marker band).

- All other CLIs exit 0. The claim markers are intact and resolve correctly (ns-claims exits 0). No continuity name mismatches were introduced (ns-scrub exits 0). No doctor anomalies beyond what the rewrite itself introduces (ns-doctor exits 0). No prompt-scrub violations (ns-probe exits 0).

## Changed-file Footprint

This fixture differs from the golden book in exactly four locations:

1. **chapters/02-finding-your-network.md** - Register rewrite from golden baseline (second-person active) to passive third-person impersonal.
2. **.studio/config.json** - `thresholds.drift_score_max` pinned to 20 only; `gate.checks.stylometry.mode` and `dod.require_drift_under_threshold` restored to their golden values. Mode toggles have no effect on exit codes: the ns-stylometry engine exits 1 on threshold exceedance per the S-07 (hooks and scripts) contract, regardless of gate mode. Gate mode governs only the gate's pass/fail decision.
3. **.studio/progress.json** - Word counts updated to 493 (chapter 2) and 913 (total) to match the rewritten chapter and maintain state coherence. The ns-doctor coherence check exits 0 here; the coherence anomaly detector lives in the unsourced-claim fixture.
4. **structure/chapter-list.md** - Chapter 2 word count (462 to 493) and total (882 to 913) kept coherent with progress.json.

(Footprint documented 2026-07-18 per the TSK-022 (voice-drift fixture) review adjudication.)
