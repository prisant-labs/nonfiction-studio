# Planted Defect: Continuity Error (Name Mismatch)

## Location

File: `chapters/02-finding-your-network.md`
Line: 3

## Name Pair

Correct form: `personal learning network`
Variant form: `Personal Learning Network`

## Occurrence Census

Chapter 1 contains the established term in lowercase (line 17):
- "A well-curated personal learning network produces a self-reinforcing loop..."

Chapter 2 contains 1 occurrence of the surface-casing variant (line 3):
- "The phrase 'Personal Learning Network' can sound like a vague ambition."

## Expected Engine Behavior

The ns-scrub continuity mode should detect this name-mismatch defect and:

- Exit with code 1
- Name the file location: `chapters/02-finding-your-network.md`
- Identify the line range: line 3
- Flag this as a continuity.name-mismatch defect spanning chapter 2 per the S-07 mechanism (case-folded identity index)

All other CLIs should exit 0 on this fixture, as the case variance does not affect claim markers or other validation rules.

## Defect Properties

- Type: Surface-casing variance of an established term (case-folded identity preserved)
- Scope: Chapter 2 only
- Claim markers: Intact and unaffected by the name change
- Sentences affected: 1 sentence at line 3
- Defect class corrected 2026-07-18 per the TSK-021 (continuity-error fixture) adjudication: a transposition typo is invisible to deterministic term-identity scanning.
