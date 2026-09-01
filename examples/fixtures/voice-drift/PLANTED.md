# Planted Defect: Voice Drift (Ghostwriting Transform on Chapter 2)

## Purpose

This fixture demonstrates the CHAPTER-REGIME tier of ADR-0012 (voice verdict scope) Decision 2,
complementing `examples/sample-book`'s book-regime demonstration. The two fixtures together prove
both branches of the gate's two-tier regime dispatch (P6, `hooks/lib/gate-engine.mjs`):

- `examples/sample-book` -- a sparse, book-scale voice (calibration regime: book) -- proves the
  aggregate-only, floor-gated path.
- `examples/fixtures/voice-drift` (this fixture) -- a first-person-rich, contraction-rich
  conversational-essay voice (calibration regime: chapter) -- proves the per-chapter, floor-free
  path, including the gate's chapter-regime detail phrasing that names the worst chapter and its
  worst marker.

This fixture carries its OWN author voice, calibrated from its OWN independent corpus
(`context/samples/voice-corpus-01.md`, `-02.md`, `-03.md`), distinct from the sample book's voice.
The two fixtures are not clones of the same author; they are deliberately different authors
demonstrating different regimes.

## Location

File: `chapters/02-finding-your-network.md`
Scope: entire chapter 2

Chapter 1 (`chapters/01-listening-before-speaking.md`) is this fixture's own undrifted voice,
written fresh in the calibrated author's register. It carries no transformation and is expected
to PASS.

## The transformation

Chapter 2's committed text is NOT hand-authored prose imitating a register shift. It is the
mechanical output of `ghostwriteTransform` (`hooks/lib/stylometry-calibration.mjs`), the same
transform `calibrateBaseline` itself uses to synthesize the positive (ghostwritten) class for the
regime detectability measurement, applied here to a real, hand-authored undrifted draft of
chapter 2 written in the same voice as chapter 1.

`ghostwriteTransform` is deliberately crude, not grammar-aware (quoting its own doc comment,
`hooks/lib/stylometry-calibration.mjs`):

> every contraction is expanded to its (approximate) full form, and every first-person pronoun --
> singular or plural -- becomes its third-person-plural equivalent, case-preserved. This is a
> crude, mechanical transform, not a grammar-aware rewrite: "I'm" becomes "I am" and then, in the
> same pass, "I" becomes "They", yielding "They am" rather than "They are" -- the transform is not
> trying to produce fluent prose, only to move the eight-marker vector the same direction a
> wholesale ghostwriting pass reliably moves it (contraction_rate and first_person_rate collapsing
> toward zero).

The committed chapter 2 reads exactly this way: "They just hadn made the list deliberate" (from
"I just hadn't made the list deliberate" -- `'t` expands to nothing, then `I` becomes `They`), "For
them it been a technical skill" (from "For me it's been a technical skill" -- `'s` also expands to
nothing), "an industry workings" (from "an industry's workings" -- the same empty `'s` expansion
applied to a possessive, not just a contraction). This is the documented, intended crudeness, not
an authoring mistake -- it is the exact same transform `calibrateBaseline` measures
`detectability_auc` against, applied here to real chapter content instead of a resampled
calibration block.

All five claim markers on chapter 2 (EV-0006 through EV-0010) and all five on chapter 1 (EV-0001
through EV-0005) are preserved verbatim: the transform's regexes only touch apostrophe-joined
tokens and first-person pronoun words, never `[claim: EV-nnnn]` marker text.

## The corpus and calibration

`context/samples/voice-corpus-01.md`, `-02.md`, `-03.md`: 2,551 usable words (measured by the
canonical tokenizer, `countWords`), well above `MIN_CALIBRATION_WORDS` (2,200). Three independent
personal essays in the calibrated voice (a first-person, contraction-dense, anecdote-driven
register), none of them chapter text and none of them the source draft chapter 2 was transformed
from.

Calibrated via `ns-stylometry --calibrate=<the three corpus files>` (ADR-0012, voice
verdict scope). The regime call is measured, not asserted:

```
ns-stylometry: regime = chapter. Detectability AUC 1.000 at the 550-word rung meets the 0.95 bar,
so per-chapter verdicts are supportable.
```

`detectability_auc` of 1.000 means the ghostwritten (positive-class) resampled blocks and the
same-voice (negative-class) resampled blocks were perfectly separated by the max\|z\| statistic at
every one of the 1,000 calibration replicates at the 550-word rung -- the corpus's saturating,
near-universal first-person/contraction density (11.45 first-person mentions per 100 words; 1.32
contractions per sentence) leaves no ambiguous middle ground for the transform to hide in.

## Measured verdicts (real engine, real committed files)

### Per chapter (`ns-stylometry --chapter=<slug> --json`)

| Chapter | scoredWords | statistic | threshold | worst marker | verdict |
|---|---|---|---|---|---|
| 01-listening-before-speaking (undrifted) | 685 | 2.40 | 3.50 | type_token_ratio | pass |
| 02-finding-your-network (planted/drifted) | 586 | 13.62 | 3.52 | first_person_rate | block |

Chapter 2's `first_person_rate` collapses to exactly 0.0000 (100% deviation, z = -13.62): every
first-person pronoun in the undrifted draft was converted to a third-person-plural form.
`contraction_rate` also collapses to exactly 0.0000 (100% deviation, z = -7.07): every apostrophe
contraction was expanded (or, for `'s`/`'t`, silently dropped, per the transform's own crudeness).
`avg_word_length` rises sharply (z = 12.95): expanding contractions removes the many very-short
apostrophe-fragment tokens ("ve", "re", "d") that the tokenizer produces from unexpanded
contractions, so word length is measurably longer once they're gone.

### Aggregate (`ns-stylometry --json`, the default/`--all` scope -- also what
`scripts/test-fixtures.mjs`'s matrix row runs)

statistic 10.60, threshold 3.49, worst marker first_person_rate, scoredWords 1271. Exceeds even
diluted by half against the unchanged chapter 1: the planted chapter's signal is strong enough
that the book-wide average still clears the calibrated threshold by roughly 3x.

### Gate (`ns-gate --json`, block mode, chapter regime)

```
worst chapter chapters/02-finding-your-network.md (worst marker first_person_rate): drift
statistic 13.62 exceeds threshold 3.52; stylometry.drift-threshold
```

Top-level verdict: block, exit 1. Chapter regime has no book-scale word floor (P6,
`MIN_BOOK_VERDICT_WORDS` applies only to the book-regime path); each chapter is scored and judged
on its own against `MIN_SCORABLE_CHAPTER_WORDS` (50), which both chapters clear comfortably. The
gate's `drift.per_chapter` field carries both chapters' individual statistics: chapter 1's 2.40
never approaches its own 3.50 threshold, so the worst-chapter ranking (by statistic/threshold
ratio, not raw statistic) correctly names chapter 2.

In the fixture's own default (warn) gate mode, the same measurement produces top-level verdict
warn, exit 0 (T07).

## Expected engine behavior

- `bin/ns-stylometry --chapter=01-listening-before-speaking` exits 0 (pass).
- `bin/ns-stylometry --chapter=02-finding-your-network` exits 1 (block; first_person_rate).
- `bin/ns-stylometry` (default/`--all`, the aggregate) exits 1 (block; first_person_rate).
- `ns-gate` in block mode exits 1, top-level verdict block, stylometry check block. In the
  fixture's own warn mode, exits 0, top-level verdict warn.
- All other CLIs exit 0 on this fixture: claim markers resolve (`ns-claims`, 10/10, 100%
  coverage), no continuity name-mismatches or prompt-scrub violations (`ns-scrub`, the single
  injection-and-continuity engine for both), no doctor anomalies (`ns-doctor --check`).

## Changed-file footprint

This fixture differs from a hypothetical undrifted version of itself in these locations:

1. **`chapters/01-listening-before-speaking.md`** -- rewritten in this fixture's own calibrated
   voice (first-person, contraction-dense, anecdote-driven); undrifted; carries EV-0001 through
   EV-0005 on the same underlying claims as before.
2. **`chapters/02-finding-your-network.md`** -- rewritten in the same voice, then mechanically
   transformed by `ghostwriteTransform`; the planted defect; carries EV-0006 through EV-0010 on
   the same underlying claims as before.
3. **`context/samples/voice-corpus-01.md`, `-02.md`, `-03.md`** (new) -- this fixture's
   independent calibration corpus, 2,551 usable words across three personal essays. Supersedes
   `context/samples/voice-sample-01.md` (removed; it modeled the sample book's voice, not this
   fixture's own).
4. **`context/style-profile.md`** -- Voice/Diction/Rhythm/Do/Do-not sections rewritten for the
   new author; Exemplars point at the three new corpus files; Baseline reference `captured` and
   `sample_count` agree with `.studio/config.json`.
5. **`context/brief.md`** -- section 6 (Voice) rewritten to match; unrelated sections unchanged.
6. **`.studio/config.json`** -- `thresholds.drift_score_max` removed (P7, ADR-0012 retirement);
   `stylometry.baseline` replaced wholesale with the real, measured v5 baseline (markers +
   `marker_set_version: 5` + a full five-rung `calibration` ladder, `captured`, `sample_count: 3`,
   `method`) from `ns-stylometry --calibrate` over the three corpus files. `gate.checks.stylometry
   .mode` stays `warn` (the fixture's own default); mode toggles have no effect on `ns-stylometry`
   CLI exit codes, only on the gate's pass/fail decision.
7. **`.studio/progress.json`**, **`structure/chapter-list.md`** -- word counts updated to 685
   (chapter 1), 586 (chapter 2), 1271 (total), matching `countWords` (the same authority
   `ns-doctor`'s word-count coherence check uses) on the final committed chapter text.

(Footprint rewritten 2026-09-01 per the ADR-0012 implementation wave, Task 5 continuation: the
coordinator's ruling that this fixture becomes the chapter-regime demonstration, replacing the
prior v4 book-level drift-score-max design, which could not be recaptured under v5 because its own
undrifted two-chapter source text -- 1,055 words -- sits below `MIN_CALIBRATION_WORDS` (2,200).)
