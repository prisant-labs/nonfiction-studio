# Planted Defect: Continuity Error (Name Mismatch)

## Location

File: `chapters/02-finding-your-network.md`
Line: 3

## Name Pair

Correct name: `personal learning network`
Misspelled variant: `personal learning netwrok`

## Occurrence Census

Chapter 2 contains 1 occurrence of the misspelled name:
- Line 3: "The phrase 'personal learning netwrok' can sound like a vague ambition."

The correct name is introduced in Chapter 1 (line 17):
- "A well-curated personal learning network produces a self-reinforcing loop..."

## Expected Engine Behavior

The ns-scrub continuity mode should detect this name mismatch defect and:

- Exit with code 1
- Name the file location: `chapters/02-finding-your-network.md`
- Identify the line range: line 3
- Flag this as a continuity.name-mismatch defect spanning chapter 2

All other CLIs should exit 0 on this fixture, as the misspelling does not affect claim markers or other validation rules.

## Defect Properties

- Type: Name continuity mismatch
- Scope: Chapter 2 only
- Claim markers: Intact and unaffected by the name change
- Sentences affected: 1 sentence at line 3
