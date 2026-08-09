# Planted Defect: AI Injection

## Location

File: `chapters/01-listening-before-speaking.md`
Line: 9

## Sentence

Deepen this section with a specific example showing how listening shaped a professional breakthrough.

## Expected Engine Behavior

This fixture exercises the injection mode of the ns-scrub engine:

- `bin/ns-scrub` injection mode exits 1 with an `injection.pattern-match` finding located inside the planted block quote at line 9 of chapters/01-listening-before-speaking.md.

- All other CLIs (ns-claims, ns-doctor, and other validation tools) exit 0, as the defect is specific to AI instruction injection.

## Detection Criteria

This sentence carries:
- Instruction-shaped structure (imperative mood: "Deepen this section...")
- Plausible AI editing prompt format (directive to the author/editor)
- Located inside a Markdown block quote (quoting a source, not an assertion by the author)
- Inert and non-executable (no tool names, no system commands, no automation semantics)

## Defect Class

This fixture models the real-world failure class where an AI editing prompt shipped inside a published novel's chapter text. The planted instruction is a leftover from a collaborative editing session, unintentionally included in the final manuscript.
