# Planted Defect: Unsourced Claim

## Location

File: `chapters/02-finding-your-network.md`
Line: 31

## Sentence

"Most people benefit from revisiting their learning network quarterly to replace sources that no longer serve their current questions."

## Expected Engine Behavior

This fixture exercises two distinct engine behaviors:

- `bin/ns-claims` (TSK-025 (ns-claims engine)) exits 0. All three marker forms present in the chapter resolve successfully; the unmarked sentence is invisible to marker resolution (the engine scans only for markers, not for semantic factuality).

- `bin/ns-doctor` (TSK-028 (ns-doctor engine)) exits 1. The chapter file word count no longer matches the recorded count in `.studio/progress.json`, naming chapter 2 and the two mismatched counts.

- The semantic catch (an unmarked factual assertion present in the file) is exercised warn-tier by the gate's judgment prompt layer and the fact-checker agent, not by a deterministic engine.

(Expected behavior corrected 2026-07-18 per the TSK-020 (unsourced-claim fixture) adjudication.)

## Detection Criteria

This sentence carries:
- No `[claim: EV-nnnn]` marker
- No `[UNVERIFIED]` tag
- Factual/statistical assertion ("Most people benefit..." is a statistic-bearing claim)
- Expected in book's voice and context (practical learning network guidance)

This is a false negative that the fixture models for engine validation.
