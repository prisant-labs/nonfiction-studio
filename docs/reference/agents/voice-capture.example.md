---
title: "voice-capture worked example"
description: "Condensed transcript of a voice-capture session for The Quiet Network - shows brief reading, CLI invocation, draft profile, and confirm-before-commit"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "intake", "voice", "example"]
---

# voice-capture - worked example

This is a condensed transcript of a `voice-capture` session for the sample book
"The Quiet Network" (see `examples/sample-book/`). It follows Path A (writing
samples available), showing the brief reading, the `bin/ns-stylometry --measure`
invocation, the draft profile excerpt, and the confirm-before-commit step. It
honors the contracts specified in S-01 (intake and context agents) and D-08
(hybrid voice scoring).

---

## Setup: what was already in place

The `interviewer` agent completed intake over two sessions. Section 6 of
`context/brief.md` records:

```
<!-- DRAFT section-6 completed 2026-07-18 -->
Tone: plainspoken, warm, practical.
POV and tense: second person for instruction; first person for occasional
anecdote; present tense.
Register: trade non-fiction, pitched at an informed friend rather than a lecturer.
Avoid: unlock, leverage, guru-speak.
Writing sample: one blog excerpt provided. FLAGGED FOR voice-capture; not
analyzed here.
<!-- END DRAFT section-6 -->
```

The author's sample is saved at `context/samples/voice-sample-01.md`.

---

## Session: capture and commit

**Author:** `/nonfiction-studio:nfs-capture-voice`

**voice-capture:**

> I read section 6 of `context/brief.md`. Your stated preferences: plainspoken,
> warm, practical; second person for instruction with first-person anecdotes;
> present tense; trade non-fiction register pitched at an informed friend. You
> listed "unlock," "leverage," and "guru-speak" as terms to avoid.
>
> I see a writing sample at `context/samples/voice-sample-01.md`. Reading it now.

The agent reads `context/samples/voice-sample-01.md` and observes: short to
medium sentence length, predominantly second person ("You probably already know..."),
present tense throughout, plain Anglo-Saxon diction, no jargon, one-sentence
paragraphs used for emphasis, direct address as the dominant opener pattern.

**voice-capture:**

> Resolving the plugin root, then running the stylometry engine to compute the
> baseline vector.

The agent resolves the plugin root (the `nonfiction-studio` entry in
`~/.claude/settings.json`; per ADR-0005 (bin PATH on Windows), the hooks.json
plugin-root variable is not available in a live Bash shell) and invokes:

```
node "<plugin-root>/bin/ns-stylometry" --measure=context/samples/voice-sample-01.md
```

The engine prints to stdout:

```json
{
  "markers": {
    "function_word_rate": 0.4612,
    "contraction_rate": 0.0182,
    "first_person_rate": 1.8367,
    "second_person_rate": 5.7143,
    "type_token_ratio": 0.6735,
    "avg_word_length": 4.8980,
    "avg_sentence_length": 11.0000,
    "punctuation_rate": 11.4286
  },
  "marker_set_version": 4,
  "files": ["context/samples/voice-sample-01.md"],
  "totalWords": 98
}
```

The agent reads both the `markers` object AND the `marker_set_version` number
from stdout and writes them into `.studio/config.json` at
`stylometry.baseline.markers` and `stylometry.baseline.marker_set_version`
using read-modify-write (all other config fields are preserved untouched).
Writing `markers` alone, without `marker_set_version`, would leave a baseline
the drift scorer refuses to score against.

**voice-capture:**

> Baseline vector written to `.studio/config.json`. Drafting the voice profile now.

The agent drafts `context/style-profile.md`:

```markdown
# Style profile

## Voice
- tone: plainspoken, warm, practical; never breathless or performative.
- point-of-view: second person for instruction; first person singular for
  anecdote and personal illustration.
- tense: present for principles and instruction; past for anecdotes.
- register: trade non-fiction, the register of an informed friend, not a lecturer.

## Diction
- prefer: concrete nouns, short Anglo-Saxon verbs, named examples.
- prefer: one-sentence paragraphs for emphasis when the point is complete.
- avoid: jargon without a gloss, stacked qualifiers, latinate noun phrases where
  a plain verb phrase works.

## Rhythm
- sentence length: short to medium; mean approximately 11 words; occasional
  one-sentence paragraphs for punch and emphasis.
- paragraph length: two to four sentences for expository passages; single
  sentence permitted for closing emphasis.

## Do
- open with a concrete question or a direct statement the reader can test
  against their own experience.
- earn every abstraction with a named example within two sentences.
- use "you" to address the reader directly in instructional passages.
- end a section's last paragraph with a short sentence that names the single
  takeaway.

## Do not
- start sentences with "In today's world" or "It is important to note."
- use: unlock, leverage, guru-speak, game-changer, next-level, hustle, journey
  (metaphoric), showing up (metaphoric).
- open a section with a rhetorical question.
- use passive construction in the opening sentence of any paragraph.

## Exemplars
- context/samples/voice-sample-01.md

## Baseline reference
- vector: .studio/config.json -> stylometry.baseline.markers
- captured: 2026-07-18T10:00:00Z
- sample_count: 1
- bootstrapped: false
```

**voice-capture:**

> Draft profile above. Does this capture your voice and constraints accurately?
> One round of corrections welcome.

**Author:** "Looks right. Add 'showing up (metaphoric)' to the banned tics - I
overuse that one. And the note about first-person for anecdotes is correct."

The agent adds the new tic to the Do not section and confirms the POV note is
already captured.

**Author:** "Good. Commit it."

The agent writes the confirmed `context/style-profile.md` with `bootstrapped: false`.

**voice-capture:**

> Profile committed. The stylometric baseline is set; the gate can score drift
> from the next chapter forward. Want to build the outline with `structure-architect`,
> start drafting with `drafting-partner`, or sharpen the thesis with
> `thesis-architect`?

---

## Key assertions from this transcript

- **Brief read first.** The agent reads `context/brief.md` section 6 before asking
  any questions, so intake preferences (tone, POV, tense, register, banned terms)
  flow into the profile without the author having to repeat them.
- **Engine is the counting authority.** The agent resolves the plugin root,
  then invokes `node "<plugin-root>/bin/ns-stylometry" --measure=...` via the
  Bash tool; it reads the printed markers from stdout and writes them into
  `.studio/config.json`. The engine computes; the agent writes.
- **Config write uses read-modify-write.** Only `stylometry.baseline.markers`
  and `stylometry.baseline.marker_set_version` are changed; all other config
  fields (gate modes, thresholds, model overrides) are preserved.
- **No profile without a baseline.** The vector is written to `.studio/config.json`
  before the profile draft is presented. A confirmed profile always pairs with a
  numeric baseline.
- **Confirm before commit.** `context/style-profile.md` is not written until the
  author explicitly confirms. The author's correction (adding a banned tic) is
  incorporated first.
- **Own-prose primacy.** The sample used is the author's own blog excerpt, not an
  admired author's passage. Any emulation reference is described as reference only.
- **Bootstrapped flag is false.** Because own prose formed the baseline, the profile
  records `bootstrapped: false`.
- **Handoffs are choices.** After commit, `structure-architect`, `drafting-partner`,
  and `thesis-architect` are named as options, not a mandated pipeline.
