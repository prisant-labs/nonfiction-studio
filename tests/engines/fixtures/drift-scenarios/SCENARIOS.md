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
(7.6% of budget) while leaving rows 1-4 safely passing and row 6 measuring pass despite a
ground truth of block (a disclosed divergence, not a design goal; see "Row 6" below); a
smaller per-marker divisor
and a raw-occurrence-count damped bound were also evaluated and rejected (see the
`DEFAULT_DRIFT_SCORE_MAX` doc comment in `hooks/lib/stylometry-engine.mjs` for why).

| # | File | Transformation | Ground truth | Old default (35) | New default (25) |
|---|---|---|---|---|---|
| 1 | `01-unchanged.md` | none | pass | 10.86 pass | 10.86 pass |
| 2 | `01-contractions-removed.md` | contractions only | pass | 23.20 pass | 19.87 pass |
| 3 | `01-first-person-removed.md` | first person only | pass | 21.87 pass | 18.53 pass |
| 4 | `01-second-person-removed.md` | second person only | pass | 15.98 pass | 12.65 pass |
| 5 | `01-contractions-and-first-person-removed.md` | contractions + first person | **block** | 33.58 pass | 26.91 **block** |
| 6 | `01-first-and-second-person-removed.md` | first + second person | block (see note) | 26.78 pass | 20.11 **pass** |
| 7 | `01-contractions-first-second-removed.md` | all three | block | 38.27 block | 28.27 block |
| 8 | `different-voice.md` | genuinely different voice (voice-drift ch2) | block | 62.97 block | 51.35 block |
| 9 | `01-honest-variance-depadded.md` | de-padded ch1, self-fit baseline | pass (see note) | 41.46 block | 34.80 block |
| 10 | `02-honest-variance-depadded.md` | de-padded ch2, self-fit baseline | pass (see note) | 39.98 block | 33.08 block |

Row 5 is the regression this task exists to close: at the old default, a chapter with every
contraction and every first-person pronoun stripped -- the canonical ghostwriting signature,
literally half of this project's own planted `voice-drift` defect -- passed. At the new
default it blocks.

### What actually makes row 5 block, decomposed

Row 5's score at the shipped default (26.91) is not mostly the transformation's own signal.
Rescored against chapter 1's own true baseline instead of the two-chapter self-fit baseline
(removing the population-mismatch floor every chapter carries when scored against a baseline
it is only half of), row 5's genuine knock-on in the six markers the transformation does not
touch directly is about 6.05 points -- short of the roughly 8.33 points that budget 25's
per-marker cap would need from residual alone to push the two fully-saturated markers over
budget. The other roughly 4.2 points of the 10.25-point residual actually measured (against
the real, shipped, same-book self-fit baseline) are the same population-mismatch floor an
UNCHANGED chapter 1 carries on its own (10.86 points, row 1 above). At the shipped default,
this calibration blocks row 5 partly by leaning on that floor, not from the transformation's
signal alone.

### Row 6: ground truth set from measurement, not independent judgment

An earlier version of this file labeled row 6 "pass," on the reasoning used for rows 2-4:
that the per-marker bound exists so a single stylistic axis cannot alone decide the verdict.
Row 6 moves two axes (first- and second-person pronouns both removed), the same count as row
5, so that reasoning does not actually reach it -- the label was set to match what the engine
does, not derived independently the way rows 2-5, 7, and 8 are. Row 5's own reasoning (two
markers moving together is the signature this recalibration targets) applies to row 6 just as
much, so ground truth here is relabeled **block**, and the divergence from the shipped
default's measured verdict (**pass**, at both the old and new default) is disclosed the same
way rows 9-10 disclose theirs, rather than silently matching the label to the measurement.

The mechanism is the same knock-on-versus-floor split as row 5, at different magnitudes.
Summed across the six markers the transformation does not directly touch, row 5 carries about
10.2 points of residual against the shipped self-fit baseline (about 6.05 genuine, about 4.2
floor, per the decomposition above); row 6 carries about 3.4. Both are two-marker signatures;
the difference is entirely in how much the surrounding six markers also move, and expanding
contractions (row 5) disturbs them more than substituting pronouns alone (row 6) does. This
is a real, measured difference in this corpus, not a reason row 6 deserved a different ground
truth -- it is the reason row 6 is the calibration's binding constraint: at divisor 3, no
budget both keeps row 1 passing and makes row 6 block (row 6 needs budget under about 10.3
for its own two-marker-plus-residual sum to reach it, and row 1's own floor is 10.86, already
above that). Catching row 6 at divisor 3 is not available at any budget; it would need either
a different divisor or the joint budget-and-divisor region described in
`docs/reference/cli/ns-stylometry.md`'s Calibration section.

### Honest-variance scenario (rows 9-10): ground truth vs. measured verdict

These two rows are the case this recalibration was commissioned to fix. Ground truth is
**pass**: two honestly written chapters from the same author, scored against a baseline
self-fit from just the two of them, is natural variation, not drift. The measured verdict at
the shipped default (divisor 3, budget 25) is **block**, at both the old and the new default
budget. Proof for the shipped divisor specifically: while exactly two markers stay pinned at
the per-marker bound for both row 5 and rows 9-10 -- true at both budget 35 and budget 25,
divisor 3 -- each case's score is `2 x (budget/divisor) + residual`, with `residual` constant
across budget and divisor IN THAT REGIME. Row 5's residual is about 10.2; rows 9 and 10's are
about 18.1 and 16.7. Honest variance is offset above the ghostwriting signature by that gap
throughout the regime, so at divisor 3, no budget in the range this calibration could
responsibly ship passes rows 9-10 while blocking row 5.

That regime does not hold everywhere, and the constant-residual argument does not generalize
past it the way an earlier version of this file claimed. Rows 9-10's largest single deviation
(16.49% for row 9) means their score has a hard ceiling: once the per-marker cap exceeds that
value, every marker is uncapped and the score stops changing (47.09 for row 9, 44.54 for row
10) no matter how much further the cap grows. Row 5's two manipulated markers sit at exactly
100% deviation and have no such ceiling below a cap of 100. Past a cap of about 18.42, row
5's climbing score exceeds rows 9-10's flat ceiling, and the two cases separate. Budget 50,
divisor 2.5 (cap 20) is a verified working point: row 5 scores 50.24 and blocks, rows 9-10
score 47.09 and 44.54 and pass, and every other row in the table above still matches its
ground truth. This was not adopted as the shipped default; see `docs/reference/cli/
ns-stylometry.md`'s Calibration section for the real reasons (the feasible region is narrow,
it degrades the three-marker guarantee at its own low end, and it ripples into every
divisor-derived number this project ships) and for what changing the shipped default there
would actually require.

The test for rows 6, 9, and 10 asserts the MEASURED verdict, not the ground truth, and says
so in the test's own comments -- a suite that silently matched ground truth to whatever the
engine currently does would be hiding these findings, and a suite that left the rows out
would be hiding them more effectively.

### The suite does not, by itself, select 25

At divisor 3, the eight scenarios above other than rows 9-10 are jointly consistent with any
budget from about 16.12 to 30.73 -- a band roughly 14.6 points wide, not a single point. 25
sits inside that band; it is not derived uniquely from the labeled scenarios the way each
scenario's own verdict is. The floor-fraction test in `tests/engines/stylometry-
calibration.test.mjs` (asserting row 1's score is 43.4% of budget) narrows the pin further,
but that test is a statistic computed from the chosen value of 25, not an independent
ground-truth constraint like the scenario verdicts above -- it detects drift away from 25
once 25 is chosen, it does not justify 25 over another point in the 14.6-point band.
