# Planted Defect: Unsourced Claim

## Location

File: `chapters/02-finding-your-network.md`
Line: 31

## Sentence

"Most people benefit from revisiting their learning network quarterly to replace sources that no longer serve their current questions."

## Expected Engine Behavior

The ns-claims engine should detect this sentence as an unmarked factual claim lacking verification markers. Per Q-01 (testing and evals) section 2.1, the engine should:

- Exit with code 1
- Name the file location: `chapters/02-finding-your-network.md`
- Identify the line range: line 31
- Flag this as a missing claim marker defect

## Detection Criteria

This sentence carries:
- No `[claim: EV-nnnn]` marker
- No `[UNVERIFIED]` tag
- Factual/statistical assertion ("Most people benefit..." is a statistic-bearing claim)
- Expected in book's voice and context (practical learning network guidance)

This is a false negative that the fixture models for engine validation.
