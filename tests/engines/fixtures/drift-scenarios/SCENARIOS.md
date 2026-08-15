# Drift calibration scenario suite

Labeled ground-truth fixtures for `tests/engines/stylometry-calibration.test.mjs`. Each
chapter file here is a single named transformation of the golden sample book's chapter 1
(`examples/sample-book/chapters/01-listening-before-speaking.md`) or, for the two
honest-variance files, both golden chapters with their closing paragraph removed.

**Frozen by design.** Every file in this directory is a static, committed snapshot taken on
2026-08-15. Nothing here is regenerated from `examples/` at test time and nothing in this
directory is read by any shipped code path. This is deliberate: `examples/sample-book` is
expected to change again (its padded closing paragraphs are scheduled for removal in a later
task), and this suite's job is to keep measuring the same fixed scenarios before and after
that happens, not to silently re-measure whatever `examples/` currently contains. If
`examples/sample-book` changes, this directory does not need to change with it.

`baseline.json` is a frozen copy of the golden book's `stylometry.baseline` object as it was
committed on 2026-08-15 (`markers` plus `marker_set_version`), copied verbatim from
`examples/sample-book/.studio/config.json`.

## Transformation methodology

Two pronoun families are tracked by the engine: `FIRST_PERSON` (i, me, my, mine, myself, we,
us, our, ours, ourselves) and `SECOND_PERSON` (you, your, yours, yourself, yourselves). To
remove a pronoun family from a passage while disturbing everything else as little as
possible, every scenario substitutes third-person-plural forms (they/them/their/theirs/
themselves) for first- or second-person pronouns. This choice is deliberate: third-person
words are not tracked by either pronoun marker, they are already members of the engine's
`FUNCTION_WORDS` set (so `function_word_rate` is not perturbed by the swap), and they are the
closest grammatical substitute available, so sentence structure and word count stay close to
the original.

To remove contractions, every apostrophe-bonded token the engine's `CONTRACTION_RE` would
match (`I've`, `community's`, `people's`, `doesn't`, `I'm`) is expanded to its non-apostrophe
form. Two of chapter 1's five apostrophe tokens (`I've`, `I'm`) are simultaneously
first-person pronouns -- the pronoun IS the contraction in the source prose. Scenarios that
remove only contractions expand these to `I have` / `I am` (keeping the pronoun); scenarios
that remove only first person turn them into `They've` / `they're` (keeping the apostrophe);
scenarios that remove both turn them into `They have` / `they are` (removing both markers at
once). This is called out explicitly because an earlier draft of this suite chained two
independent regex passes and the second pass silently no-op'd on text the first pass had
already changed -- a real bug, caught by inspecting the per-marker output, not by inspection
of the diff.

De-padding (the two `*-honest-variance-depadded.md` files) removes the entire final paragraph
of each golden chapter -- the shared "X is the Y, and the Y is the X" rhetorical closer both
chapters end on. Chapter 1's closer contains no apostrophe or pronoun tokens; chapter 2's
closer contains one of each (`It's`, `I`, `your`). This asymmetry is not engineered -- it is
what is actually in the golden text -- and it is the mechanism behind the finding these two
files exist to demonstrate (see "Honest-variance scenario" below).

`different-voice.md` is a verbatim copy of `examples/fixtures/voice-drift/chapters/
02-finding-your-network.md` (the planted register-shift fixture's rewritten chapter 2:
passive, third-person, impersonal). Copied here rather than read live so this suite does not
depend on that fixture's file staying byte-identical. It is scored here against the GOLDEN
baseline (not the voice-drift fixture's own baseline), for an apples-to-apples comparison
against every other scenario in this suite. The voice-drift fixture's own pass/block
behavior, against its own baseline and its own budget of 20, is verified separately by the
pre-existing tests in `tests/engines/stylometry.test.mjs` and is not re-derived here.

## Scenario table

Scores below are `measureChapter` + `computeDrift` against `baseline.json`, divisor
unchanged at 3 (`MARKER_CONTRIBUTION_DIVISOR` in `hooks/lib/stylometry-engine.mjs`). "Old
default" is 35, the value shipped before this recalibration. "New default" is 25
(`DEFAULT_DRIFT_SCORE_MAX` in `hooks/lib/stylometry-engine.mjs`), chosen from a budget sweep
of 20 through 35 as the value that gives row 5 below a comfortable, non-hairline margin
(7.6% of budget) while leaving rows 1-4 and 6 safely passing; a smaller per-marker divisor
and a raw-occurrence-count damped bound were also evaluated and rejected (see the
`DEFAULT_DRIFT_SCORE_MAX` doc comment in `hooks/lib/stylometry-engine.mjs` for why).

| # | File | Transformation | Ground truth | Old default (35) | New default (25) |
|---|---|---|---|---|---|
| 1 | `01-unchanged.md` | none | pass | 10.86 pass | 10.86 pass |
| 2 | `01-contractions-removed.md` | contractions only | pass | 23.20 pass | 19.87 pass |
| 3 | `01-first-person-removed.md` | first person only | pass | 21.87 pass | 18.53 pass |
| 4 | `01-second-person-removed.md` | second person only | pass | 15.98 pass | 12.65 pass |
| 5 | `01-contractions-and-first-person-removed.md` | contractions + first person | **block** | 33.58 pass | 26.91 **block** |
| 6 | `01-first-and-second-person-removed.md` | first + second person | pass | 26.78 pass | 20.11 pass |
| 7 | `01-contractions-first-second-removed.md` | all three | block | 38.27 block | 28.27 block |
| 8 | `different-voice.md` | genuinely different voice (voice-drift ch2) | block | 62.97 block | 51.35 block |
| 9 | `01-honest-variance-depadded.md` | de-padded ch1, self-fit baseline | pass (see note) | 41.46 block | 34.80 block |
| 10 | `02-honest-variance-depadded.md` | de-padded ch2, self-fit baseline | pass (see note) | 39.98 block | 33.08 block |

Row 5 is the regression this task exists to close: at the old default, a chapter with every
contraction and every first-person pronoun stripped -- the canonical ghostwriting signature,
literally half of this project's own planted `voice-drift` defect -- passed. At the new
default it blocks.

Row 6 shows the same nominal shape (two pronoun/contraction markers fully deviated) landing on
the opposite side of the line. The difference is the OTHER six markers' residual movement:
expanding contractions (row 5) adds words and shifts several other ratios by a few points
each; substituting pronouns alone (row 6) barely moves anything else. Summed across the six
unaffected markers, row 5 carries about 10.2 points of residual, row 6 about 3.4. The
calibration in this suite catches a two-marker signature when it comes with that much
knock-on movement; it does not catch a surgically quiet two-marker strip under the
`divisor = 3` architecture. This is a measured limit of the current design, not an oversight.

### Honest-variance scenario (rows 9-10): ground truth vs. measured verdict

These two rows are the case this recalibration was commissioned to fix and could not fix.
Ground truth is **pass**: two honestly written chapters from the same author, scored against
a baseline self-fit from just the two of them, is natural variation, not drift. The measured
verdict is **block**, at both the old and the new default. This is not a bug in this
calibration; it is a structural property of the flat per-marker cap that no choice of budget
or divisor can route around for this corpus. Proof by construction: while exactly two
markers are pinned at the per-marker bound for both cases, each case's score is
`2 x (budget/divisor) + residual`, where `residual` is that case's own sum over the other six
markers, a constant with respect to budget and divisor. Row 5's residual is about 10.2; rows
9-10's residual is about 18.1 and 16.7 respectively. Honest variance is offset ABOVE the
ghostwriting signature by that gap at every budget/divisor combination that also closes row
5. The test for these two rows asserts the MEASURED verdict (block), not the ground
truth, and says so in the test's own comments -- a suite that silently asserted `pass` here
would be hiding the finding, and a suite that left the row out would be hiding it more
effectively.
