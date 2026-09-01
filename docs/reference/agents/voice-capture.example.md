---
title: "voice-capture worked example"
description: "Condensed transcript of a voice-capture session for The Quiet Network - shows brief reading, sample persistence, the ns-stylometry --calibrate invocation, draft profile, and confirm-before-commit"
audience: "non-engineer"
level: "beginner"
tags: ["agent", "intake", "voice", "example"]
---

# voice-capture - worked example

This is a condensed transcript of a `voice-capture` session for the sample book
"The Quiet Network" (see `examples/sample-book/`). It follows Path A (writing
samples available), showing the brief reading, persisting the samples under
`context/samples/`, the `bin/ns-stylometry --calibrate` invocation, the draft
profile excerpt, and the confirm-before-commit step. It honors the contracts
specified in S-01 (intake and context agents), D-08 (hybrid voice scoring), and
ADR-0012 (voice verdict scope, Decision 3: capture calibrates, not just
measures). The `--calibrate` output shown below is a real run against
`examples/sample-book/context/samples/`'s four shipped files, reproducible by
running the same command.

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

The author's samples are the four files shipped at
`examples/sample-book/context/samples/`: `voice-sample-01.md` plus
`voice-corpus-01.md` through `-03.md`, 3,664 words total (a real, calibratable
corpus, well above the roughly 2,200-word floor).

---

## Session: capture and commit

**Author:** `/nonfiction-studio:nfs-capture-voice`

**voice-capture:**

> I read section 6 of `context/brief.md`. Your stated preferences: plainspoken,
> warm, practical; second person for instruction with first-person anecdotes;
> present tense; trade non-fiction register pitched at an informed friend. You
> listed "unlock," "leverage," and "guru-speak" as terms to avoid.
>
> You've pasted four writing samples totaling 3,664 words. Persisting them under
> `context/samples/` before calibrating.

The agent writes each sample to `context/samples/voice-sample-01.md` through
`voice-sample-04.md` (samples already on disk at the exact target path are used
as-is, not duplicated). It observes, across the four: short to medium sentence
length, predominantly second person ("You probably already know..."), present
tense throughout, plain Anglo-Saxon diction, no jargon, one-sentence paragraphs
used for emphasis, direct address as the dominant opener pattern.

**voice-capture:**

> Resolving the plugin root, then running the stylometry engine to calibrate the
> baseline. Calibration resamples the corpus a large, fixed number of times to
> measure natural same-voice variation; this run takes a few seconds to about a
> minute.

The agent resolves the plugin root (the `nonfiction-studio` entry in
`~/.claude/settings.json`; per ADR-0005 (bin PATH on Windows), the hooks.json
plugin-root variable is not available in a live Bash shell) and invokes:

```
node "<plugin-root>/bin/ns-stylometry" --calibrate=context/samples/voice-sample-01.md,context/samples/voice-sample-02.md,context/samples/voice-sample-03.md,context/samples/voice-sample-04.md
```

The engine prints to stdout (noise_scales and block_thresholds abbreviated to
the 550- and 2200-word rungs here for readability; all five rungs in
`spans` are present in a real run):

```json
{
  "markers": {
    "function_word_rate": 0.5101,
    "contraction_rate": 0.0996,
    "first_person_rate": 0.6823,
    "second_person_rate": 2.5655,
    "type_token_ratio": 0.7548,
    "avg_word_length": 4.7762,
    "avg_sentence_length": 14.5976,
    "punctuation_rate": 12.9367
  },
  "marker_set_version": 5,
  "calibration": {
    "spans": [550, 1100, 2200, 4400, 8800],
    "noise_scales": {
      "550": { "...the eight markers...": 0.0 },
      "2200": { "...the eight markers...": 0.0 }
    },
    "block_thresholds": {
      "550": 3.5927, "1100": 3.478, "2200": 4.0954, "4400": 4.7934, "8800": 5.9052
    },
    "detectability_auc": 0.525817,
    "regime": "book",
    "replicates": 1000,
    "seed": 4242
  },
  "files": ["context/samples/voice-sample-01.md", "..."],
  "totalWords": 3664
}
```

and to stderr:

```
ns-stylometry: regime = book. Detectability AUC 0.526 at the 550-word rung falls
short of the 0.95 bar, so only a book-scale aggregate verdict is supportable.
```

The agent reads `markers`, `marker_set_version`, and `calibration` from stdout
VERBATIM, keeps the stderr sentence verbatim for its completion report, states
the current UTC time as `captured` (`2026-07-18T10:00:00Z` in this example), and
writes `.studio/config.json` at `stylometry.baseline` via read-modify-write (all
other config fields are preserved untouched):

```json
{
  "markers": { "...verbatim from stdout...": 0.0 },
  "marker_set_version": 5,
  "captured": "2026-07-18T10:00:00Z",
  "sample_count": 4,
  "method": "calibrated from four author samples totaling 3664 words",
  "calibration": { "...verbatim from stdout...": {} }
}
```

Writing `markers` and `marker_set_version` without `calibration` - or either of
`captured`/`sample_count` - would leave a baseline the drift scorer refuses to
score against, or the doctor flags as incomplete.

**voice-capture:**

> Baseline calibrated and written to `.studio/config.json`. This corpus supports
> a book-scale verdict only (detectability AUC 0.526 at the 550-word rung falls
> short of the 0.95 bar for a per-chapter verdict) - drift will be scored on the
> whole book's prose, not chapter by chapter. Drafting the voice profile now.

The agent drafts `context/style-profile.md`, copying `captured` and
`sample_count` from what was just written to config rather than restating them:

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
- sentence length: short to medium; mean approximately 14.6 words; occasional
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
- context/samples/voice-sample-02.md
- context/samples/voice-sample-03.md
- context/samples/voice-sample-04.md

## Baseline reference
- vector: .studio/config.json -> stylometry.baseline.markers
- captured: 2026-07-18T10:00:00Z
- sample_count: 4
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

> Profile committed. The calibrated baseline is set - this book scores drift at
> book scale, not per chapter, for the reason stated above. Want to build the
> outline with `structure-architect`, start drafting with `drafting-partner`, or
> sharpen the thesis with `thesis-architect`?

---

## Key assertions from this transcript

- **Brief read first.** The agent reads `context/brief.md` section 6 before asking
  any questions, so intake preferences (tone, POV, tense, register, banned terms)
  flow into the profile without the author having to repeat them.
- **Samples are persisted before calibrating.** All four samples are written to
  `context/samples/voice-sample-NN.md` before `--calibrate` runs, so the engine
  reads real files and the profile's `Exemplars` paths resolve.
- **Engine is the counting and calibrating authority.** The agent resolves the
  plugin root, then invokes `node "<plugin-root>/bin/ns-stylometry"
  --calibrate=...` via the Bash tool; it reads `markers`, `marker_set_version`,
  and `calibration` from stdout verbatim, and the two regime-disclosure sentences
  from stderr verbatim. The engine computes and calibrates; the agent writes and
  relays.
- **Config write carries the full baseline.** `markers`, `marker_set_version`,
  and `calibration` come verbatim from stdout; `captured` and `sample_count` are
  the two fields the agent adds. All other config fields (gate modes, thresholds,
  model overrides) are preserved via read-modify-write.
- **Single source for agreement fields.** The profile's `Baseline reference`
  `captured` and `sample_count` are copied from what was just written to config,
  not independently restated - the two files cannot silently disagree.
- **No profile without a full calibrated baseline.** The baseline is written to
  `.studio/config.json` before the profile draft is presented. A confirmed
  profile always pairs with `markers`, `marker_set_version`, and `calibration`.
- **Regime disclosure relayed verbatim.** The agent states the assigned regime
  (book, in this run) and its reason exactly as the engine's stderr stated it,
  both when reporting the baseline and again after commit.
- **Confirm before commit.** `context/style-profile.md` is not written until the
  author explicitly confirms. The author's correction (adding a banned tic) is
  incorporated first.
- **Own-prose primacy.** The samples used are the author's own writing, not an
  admired author's passage. Any emulation reference is described as reference only.
- **Bootstrapped flag is false.** Because own prose formed the baseline, the profile
  records `bootstrapped: false`.
- **Handoffs are choices.** After commit, `structure-architect`, `drafting-partner`,
  and `thesis-architect` are named as options, not a mandated pipeline.
