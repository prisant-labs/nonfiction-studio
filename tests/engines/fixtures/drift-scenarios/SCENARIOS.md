# Drift calibration scenario suite

Ground-truth fixtures and provenance for `tests/engines/stylometry-calibration.test.mjs`, the
golden drift-detection suite for the calibrated-null verdict statistic (ADR-0012, voice verdict
scope). `baseline.json` in this directory is a frozen, committed copy of the corpus-calibrated v5
baseline (`markers`, `marker_set_version`, `calibration`) that `examples/sample-book`'s own
`.studio/config.json` also carries, measured by `calibrateBaseline`
(`hooks/lib/stylometry-calibration.mjs`) from the sample book's independent voice corpus
(`examples/sample-book/context/samples/voice-corpus-01.md` through `-03.md`). It deliberately
carries only `{ markers, marker_set_version, calibration }` -- `captured` and `sample_count` are
omitted on purpose: those two fields are written by the voice-capture agent for a real book config
(the read-modify-write contract in `examples/sample-book/.studio/config.json`), not by
`calibrateBaseline` itself, and this directory is a test fixture, not a book config, so it has
nothing to capture them from.

The `chapters/` subdirectory in this folder holds fixture files from an earlier version of this
suite (frozen transformations of the golden sample book's chapter 1, built before v5 shipped). No
test in `stylometry-calibration.test.mjs` reads them any longer -- see "2026-09-02 update" below
for why. They are left in place, unexercised, as a historical record of the transformation
methodology described below; nothing in the shipped product or test suite depends on their
continued presence.

## marker_set_version history (background, still accurate)

`marker_set_version` is a claim about which engine a stored baseline's `markers` were captured
under, not a measurement -- `computeDrift` refuses to score against a version it does not
recognise. It was bumped from 2 to 3 alongside a typographic-normalization fix, then 3 to 4
alongside the WORD_RE Unicode-letter fix (PF-07, accented words fragment) -- neither changed any
value in this directory's fixtures, because none of them contain a smart quote or a non-ASCII
letter.

**2026-09-01 update (ADR-0012, voice verdict scope, Task 5): the freeze broke, and here is
why.** `marker_set_version` moved from 4 to 5 alongside a change this note's original
"exempt field" reasoning did not anticipate: a v5 baseline is unscorable without a
`calibration` ladder (`InvalidCalibrationError`), and `calibrateBaseline` refuses to run
below `MIN_CALIBRATION_WORDS` (2200 usable words) -- the two golden chapters this baseline
was originally self-fit from total only 1055 words, so the exact frozen `markers` values
this file used to carry CANNOT be reproduced by any v5 `--calibrate` run over that same
two-chapter source; the minimum-corpus floor did not exist when this file was first frozen.
Rather than leave this fixture on an unscorable v4 baseline, `markers` and `marker_set_version`
here were replaced wholesale with `examples/sample-book/.studio/config.json`'s own new v5
baseline (also carrying a `calibration` object, added here for the first time) -- the same
independent, disjoint voice corpus every other sample-book-derived fixture in this wave shares.

## Transformation methodology (background: how `ghostwriteTransform` works)

This section documents the mechanism `ghostwriteTransform` (`hooks/lib/stylometry-calibration.mjs`
-- now shipped product code, used by both `calibrateBaseline`'s own positive-class synthesis and
this suite's ghost scenario) implements, kept here because it is the suite's most durable value
regardless of which combining rule scores the result.

Two pronoun families are tracked by the engine: `FIRST_PERSON` (i, me, my, mine, myself, we,
us, our, ours, ourselves) and `SECOND_PERSON` (you, your, yours, yourself, yourselves).
`ghostwriteTransform` removes the first-person family from a passage while disturbing everything
else as little as possible, by substituting third-person-plural forms (they/them/their/theirs/
themselves) for first-person pronouns. This choice is deliberate: third-person words are not
tracked by either pronoun marker, they are already members of the engine's `FUNCTION_WORDS` set
(so `function_word_rate` is not perturbed by the swap), and they are the closest grammatical
substitute available, so sentence structure and word count stay close to the original.

To remove contractions, every apostrophe-bonded token the engine's `CONTRACTION_RE` would match
(`I've`, `community's`, `doesn't`, `I'm`) is expanded to its non-apostrophe form. A token that is
simultaneously a contraction and a first-person pronoun (`I've`, `I'm`) is handled by
`ghostwriteTransform`'s own two-pass order: contraction expansion runs first (`I've` -> `I have`),
then pronoun substitution runs on the result (`I have` -> `They have`) -- both markers collapse
together, which is exactly the mechanism this transform is meant to model.

## The two-tier truth this suite asserts (2026-09-02 update, ADR-0012 Decision 2)

**What changed and why, in two sentences:** the OLD suite here asserted a per-chapter drift score
against a hand-tuned budget (`DEFAULT_DRIFT_SCORE_MAX`, `MARKER_CONTRIBUTION_DIVISOR`), a combining
rule measured on this implementation wave's own probe to discriminate a planted ghostwriting
signature from ordinary voice variation at AUC 0.53 on real prose -- a coin flip, testing how
uniform one sample book happens to be rather than whether drift detection works. `computeDrift` v5
(ADR-0012, voice verdict scope) replaced that rule with the largest standardized deviation against
a per-span noise-scale ladder measured from the author's own voice corpus, and this suite was
rewritten, not patched, to assert THAT instrument's real measured behavior instead.

Applying that instrument honestly, at the sample book's own real word count (approx 1,050 words
across its two committed chapters), surfaced a structural finding rather than a simple pass/fail:
the sample book is honestly a BOOK-regime voice (its own calibration measures
`detectability_auc: 0.59556` at the shortest rung, well under the 0.95 bar a chapter-scale verdict
needs -- see `baseline.json`), so even a genuine ghostwriting transform, applied directly to the
real chapters, does not cross threshold at that word count. The suite asserts this as a pinned
property of the system, not a caveat to explain away, in three parts:

1. **Separation at the real span**: the ghostwritten aggregate's statistic (2.3121) exceeds the
   honest aggregate's statistic (1.8320) at each text's own real scored-word count -- the
   transform's signal is real and measurable, even where the verdict scale cannot support a block.
2. **Non-block at the real span is a pinned property**: the ghost aggregate's statistic (2.3121)
   stays under its threshold (3.5835) at its real span (approx 1,047 scored words). This is the
   measured reason this baseline's regime is `"book"` and why the gate's book-scale word floor
   (`MIN_BOOK_VERDICT_WORDS`, `hooks/lib/gate-engine.mjs`) exists -- not a gap the suite is hiding.
   If a future engine change ever made this scenario block at approx 1,050 words, this property
   should fail and force a look at what changed.
3. **Block at extended spans**: the SAME measured ghost marker rates, evaluated through
   `computeDrift`'s `scoredWords` parameter at the calibration ladder's 4,400- and 8,800-word
   rungs, exceed threshold (statistic 4.9585 vs threshold 4.8650 at 4,400; 6.5317 vs 5.4269 at
   8,800), while the honest rates never exceed threshold at any of the ladder's five rungs (worst
   case 5.3931 vs 5.4269 at 8,800). This is a rates-sustained-at-span evaluation of the ladder and
   threshold themselves -- it asks whether this same deviation would register given enough scored
   words for the noise scale to tighten, not whether resampling this short text into a longer one
   would look like a realistic ghostwritten chapter. (It would not: a synthetic resample from only
   these two chapters' handful of sentences was measured, during this task's escalation, to break
   `type_token_ratio` for BOTH honest and ghostwritten resamples via sentence-reuse artifacts --
   exactly why this suite evaluates the real measured rates at each span rather than fabricating
   longer text to reach one.)

**Honest-variance canary** (regression guard, advisory framing -- matching
`hooks/lib/gate-engine.mjs`'s own book-regime handling, where per-chapter statistics are computed
and carried as advice and never decide the verdict): the two real, honest sample-book chapters
measure well inside the 1.5x-threshold canary bound.

| Chapter | statistic | threshold | ratio |
|---|---|---|---|
| `01-listening-before-speaking.md` | 1.4558 | 3.6716 | 0.3965 |
| `02-finding-your-network.md` | 1.6224 | 3.6716 | 0.4419 |

**The CHAPTER-tier block demonstration lives elsewhere, on purpose.** A voice that DOES clear the
0.95 detectability bar, and DOES block a planted drift at chapter scale, is
`examples/fixtures/voice-drift` -- its own calibrated author voice, deliberately less sparse than
the sample book's. Its gate- and CLI-level block coverage is verified by
`tests/engines/gate.test.mjs` and `tests/engines/stylometry.test.mjs`, not duplicated here: each
regime's block proof has one named home. This suite (the sample book's own fixtures) is the
book-regime demonstration; `voice-drift` is the chapter-regime one. Together they exercise both
tiers of ADR-0012 Decision 2's gate topology honestly, rather than one fixture pretending to prove
both.

**Determinism**: recalibrating `calibrateBaseline` from the three committed voice-corpus files, in
the test process itself, reproduces both this directory's `baseline.json` and
`examples/sample-book/.studio/config.json`'s own baseline (`markers` and `calibration` only --
`captured`/`sample_count`/`method` are agent-written, not measured, and excluded from the
comparison by construction) byte-for-byte. Measured runtime for the single `calibrateBaseline` call
this determinism check performs: approx 10-11 seconds.
