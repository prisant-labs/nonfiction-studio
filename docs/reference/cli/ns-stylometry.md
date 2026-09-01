---
title: "ns-stylometry CLI reference"
description: "Reference for the ns-stylometry CLI - the calibrated-null voice-drift verdict engine: the max-standardized-deviation statistic, the five-rung calibration ladder, --calibrate, --by-register, and passage attribution"
audience: "non-engineer"
level: "beginner"
tags: ["cli", "stylometry", "voice", "drift", "baseline", "calibration"]
---

# ns-stylometry

Measures an eight-marker stylometric vector for one chapter or a whole book and computes the
voice-drift verdict against the author's calibrated baseline (ADR-0012, voice verdict scope):
the largest standardized deviation (max `|z|`) across the eight markers, compared against a
threshold read from the baseline's own calibration ladder - never an assumed constant. Exits 0
when the statistic is below threshold; exits 1 when the statistic is at or above threshold, or
(in `--calibrate` mode only) when the given corpus is too small to calibrate; exits 2 on a
missing or stale baseline, an incomplete calibration ladder, an argument error, or an
operational failure.

## Purpose

`ns-stylometry` is the voice-drift engine per D-08 (hybrid voice scoring) and S-07 (hooks and
scripts). In scoring mode it reads the author's baseline from `.studio/config.json` (or a
`--baseline` override) and measures the current chapters against it using eight markers:
function-word rate, contraction rate, first-person rate, second-person rate, type-token ratio,
average word length, average sentence length, and punctuation rate (unchanged in meaning since
`marker_set_version` 4 - the eight markers themselves did not move under this wave; only the
rule that judges them did).

**The statistic.** For each marker `m`, the signed relative deviation from baseline is
`relDev_m = (measured - baseline) / baseline * 100` (0 when both are 0, else +100 - there is no
"negative" direction to fall away from zero). That deviation is standardized against a
per-marker noise scale, `z_m = relDev_m / scale_m(W)`, where `scale_m(W)` is looked up from the
baseline's own `calibration.noise_scales` ladder at the scored word count `W`: log-linear
interpolation (linear in `ln W`) between the two bracketing rungs, clamped to the nearest end
rung's value when `W` falls outside the ladder entirely. The verdict statistic is
`max over markers of |z_m|` - the single most anomalous marker, not a sum of all eight. The
threshold it is compared against is looked up the same way, from `calibration.block_thresholds`
at the same `W`. Both lookups are pure functions of the stored calibration; nothing here
assumes a fixed noise scale or an analytically derived threshold. A marker is separately
flagged (advisory only, unrelated to the verdict) when its `deviationPct` - the honest,
unsigned magnitude of `relDev_m` - exceeds `thresholds.stylometry_marker_tolerance` (default
2.0; unchanged and NOT retired by this wave).

**Why max, not sum.** The rule this replaced summed every marker's deviation, each capped at a
fixed fraction of a configured budget. Measured on this implementation wave's own labeled
probe, that rule discriminated a genuine planted ghostwriting signature from ordinary
chapter-to-chapter voice variation at AUC 0.53 on real prose at chapter scale - a coin flip.
Summing eight markers dilutes whatever signal one or two of them actually carry across six that
usually do not move at all; taking the max instead concentrates the verdict on wherever the
real signal lives, and standardizing against a per-marker, per-span noise scale (rather than an
unweighted percent) means a marker that is naturally noisy at short spans does not dominate the
verdict just because its raw percentages are large.

**Why a ladder, not one stored threshold.** A single threshold measured at one span and
adjusted for other spans by a `sqrt(span)` scaling law was measured, in this wave's own design
probe, to under-predict the true null away from its calibration point - and an under-predicted
null means excess false blocks, the exact defect ADR-0012 exists to cure. The five-rung ladder
(`spans: [550, 1100, 2200, 4400, 8800]` words) has no such structural error mode: every rung is
calibrated and evaluated independently, from its own disjoint resampled draw of the author's
voice corpus, so the interpolated value between two measured rungs is always bounded by two
real measurements rather than extrapolated from one.

## Invocation

```
ns-stylometry [--chapter=<slug>] [--all] [--baseline=<path>] [--measure=<path>[,<path>...]]
  [--calibrate=<path>[,<path>...]] [--project=<dir>] [--json] [--explain] [--by-register]
```

## Windows invocation

Bare `ns-stylometry` invocation fails in the Bash tool on Windows; the plugin
system does not add `bin/` to PATH (ADR-0005, bin PATH on Windows). Hook, skill,
and agent contexts must resolve the plugin root first, then invoke:

```
node "<plugin-root>/bin/ns-stylometry" [--chapter=<slug>] [--all] [--baseline=<path>]
  [--measure=<path>[,<path>...]] [--calibrate=<path>[,<path>...]] [--project=<dir>] [--json]
  [--explain] [--by-register]
```

where `<plugin-root>` is the resolved plugin installation path. Direct
interactive invocation from a user's own shell can add `bin/` to PATH manually,
or use the same `node` plus full-path form.

## Flags

| Flag | Type | Description |
|---|---|---|
| `--chapter=<slug>` | string | Score a single chapter file. |
| `--all` | boolean | Score every `.md` file in `chapters/` (default). |
| `--baseline=<path>` | string | Override the baseline source. Accepts a config-shaped object with `stylometry.baseline`, a bare baseline object (`markers` plus `marker_set_version` plus `calibration`), or a raw flat markers object. A raw flat markers object, or one missing `calibration`, is rejected by the same stale/incomplete-baseline guards described under Exit taxonomy, below. |
| `--measure=<path>[,<path>...]` | list | Standalone measurement mode: computes and prints the raw eight-marker vector for the given files, with no baseline comparison and no book-root discovery. JSON output only; exits 0 on success, 2 on a missing or unreadable file. Still live: `nfs-quick-scan` uses it for a project-free single measurement of pasted prose, and `nfs-capture-voice` uses it to measure each register bucket's plain vector (registers carry no calibration - see `--by-register`, below). |
| `--calibrate=<path>[,<path>...]` | list | Calibration mode: runs the five-rung noise-scale and block-threshold ladder recipe (`hooks/lib/stylometry-calibration.mjs`) over the given voice-corpus files and prints `markers`, `marker_set_version`, and the full `calibration` object as JSON. Deterministic (seed 4242, unconditional - no `--seed` flag exists). See Calibration and `--calibrate`, below, for the cost, the exit taxonomy, and the regime disclosure. |
| `--project=<dir>` | string | Override the book root to `<dir>`. Ignored by `--measure` and `--calibrate`, which never touch a book root. |
| `--json` | boolean | Emit the full drift report as JSON to stdout (scoring mode only; `--measure` and `--calibrate` always emit JSON regardless of this flag). |
| `--explain` | boolean | Render every marker's baseline, measured value, honest deviation, and signed `z`, ordered by `\|z\|` descending, plus passage attribution for the worst marker (see `--explain` output, below). Composes with both the human-readable and `--json` modes rather than replacing either one; never changes the exit code; writes nothing to disk. |
| `--by-register` | boolean | Advisory-only comparison of the scored text against every register configured in `stylometry.registers` (ADR-0012 voice verdict scope, Decision 4; closes roadmap row 1.7, voice registers). Never changes the exit code. See `--by-register` output, below. |

## Exit taxonomy

| Exit code | Meaning |
|---|---|
| 0 | Pass - the verdict statistic is below the calibrated threshold at the scored word count. In `--measure` or `--calibrate` mode, successful completion. |
| 1 | Scoring mode: the verdict statistic is at or above the calibrated threshold. `--calibrate` mode only: `CorpusTooSmallError` - the given files summed under `MIN_CALIBRATION_WORDS` (2,200) usable words, or cleared that floor on word count alone but yielded zero terminal-punctuated sentences to resample from once markdown syntax was stripped. This is a distinct row from scoring mode's exit 1: `--calibrate` never reaches a verdict at all when this fires. |
| 2 | Missing baseline; a stale baseline (`marker_set_version` does not match the engine's current version - run `nfs-capture-voice` to recapture it); a baseline whose `calibration` object is missing or incomplete (missing a rung's noise scale, block threshold, or `regime`) - the same remedy; missing chapters directory; an invalid `--measure` or `--calibrate` argument (no path given); a missing or unreadable file for either mode; or an operational error. |

`--explain` and `--by-register` never change this taxonomy: they only add detail to whichever
exit code the run already produces. A run with either flag and the same run without it always
exits with the same code for the same input, including on the exit-2 operational-error paths,
where neither flag is ever reached at all.

## Output

Human-readable pass (real run, `ns-stylometry --project=examples/sample-book
--chapter=01-listening-before-speaking`, book-regime baseline):

```
[stylometry] pass: drift statistic 1.46 < calibrated threshold 3.67
```

Human-readable block (real run, `ns-stylometry --project=examples/fixtures/voice-drift`,
chapter-regime baseline, the planted ghostwriting fixture):

```
[stylometry] drift statistic 10.60 exceeds calibrated threshold 3.49
  [contraction_rate] z=-6.2348 deviation 59.63% (baseline=1.3171 measured=0.5316)
  [first_person_rate] z=-10.6033 deviation 52.57% (baseline=11.4465 measured=5.4288)
  [type_token_ratio] z=4.4559 deviation 7.63% (baseline=0.6728 measured=0.7242)
  [avg_word_length] z=9.2369 deviation 13.27% (baseline=3.8001 measured=4.3045)
  [avg_sentence_length] z=0.5140 deviation 3.43% (baseline=15.5549 measured=16.0886)
```

(Flagged-marker lines print in the baseline's own key order, not ranked by `\|z\|` - that
ordering is what `--explain` adds, below.)

JSON output (with `--json`) follows the S-08 drift-report shape with `check`, `verdict`,
`detail`, `statistic`, `worstMarker`, `threshold`, `exceeded`, `regime`, `status`, `markers`
(per-marker `baseline`/`measured`/`deviationPct`/`z`/`flagged` - the old `capped` and
`contribution` keys are gone, replaced entirely, not alongside), `scoredWords`, `chapters`,
`findings`, and `ts` fields. `regime` (`"chapter"` or `"book"`) is read straight through from
the baseline's own `calibration.regime` - this CLI reports it for information, but (unlike
`bin/ns-gate`'s stylometry check) never acts on it: scoring mode always compares the raw
statistic to the raw threshold, with no floor or skip policy of its own. See Regime and the
two-tier gate policy, below.

### `--explain` output

`--explain` composes with both the human-readable and `--json` modes rather than replacing
either one, and never changes the exit code. It writes nothing to disk. The two real runs
below are pasted verbatim, not hand-authored.

Human-readable, a passing chapter (`ns-stylometry --project=examples/sample-book
--chapter=01-listening-before-speaking --explain`):

```
[stylometry] pass: drift statistic 1.46 < calibrated threshold 3.67
Worst marker: function_word_rate, z=-1.4558 (calibrated threshold 3.67)

Markers ranked by |z| (largest first); * marks a marker whose honest deviation crosses the 2.00% per-marker tolerance band:
* function_word_rate   z   -1.4558  deviation    4.54%  baseline 0.5079  measured 0.4848
* avg_sentence_length  z   -1.2784  deviation   11.27%  baseline 14.8761  measured 13.2000
* avg_word_length      z    1.0234  deviation    3.66%  baseline 4.7834  measured 4.9583
* second_person_rate   z    0.6485  deviation   21.25%  baseline 2.4993  measured 3.0303
* punctuation_rate     z    0.5481  deviation    3.47%  baseline 12.8124  measured 13.2576
* first_person_rate    z    0.3495  deviation   25.58%  baseline 0.6033  measured 0.7576
  type_token_ratio     z   -0.3424  deviation    0.88%  baseline 0.7564  measured 0.7498
* contraction_rate     z    0.2888  deviation   17.00%  baseline 0.1068  measured 0.1250

Passage attribution (advisory - a diagnostic passage location, not a blocking verdict):
  the function_word_rate marker's most locally deviant 100-word window is words 258-357 (local value 0.3900 vs baseline 0.5079)
```

The `*` mark is `deviationPct > markerTolerance` (the pre-existing advisory band, unchanged and
independent of the verdict); it is not the same signal as which marker attained the max `|z|`
("Worst marker," above) - `contraction_rate` is flagged here despite ranking last by `|z|`,
because its honest percent deviation still crosses the 2 percent band even though its
standardized deviation is small.

**Passage attribution** (ADR-0012 voice verdict scope, Decision 4 - roadmap row 1.7's
"names markers and passages"): for the worst marker only, a fixed 100-token window is slid one
word at a time over the scored text, and the window whose local marker value deviates most from
baseline is reported by its 1-indexed, inclusive word-offset range. Deterministic (a strict
greater-than comparison keeps the first, leftmost window on a tie), advisory only - it never
feeds back into the statistic, the threshold, or `exceeded`.

With `--json --explain` together, the JSON output above gains one additional top-level key,
`explain`, positioned after `markers`:

```json
"explain": {
  "threshold": 3.493175065600803,
  "markerTolerance": 2,
  "perMarker": [
    {
      "marker": "first_person_rate",
      "baseline": 11.446491571932576,
      "measured": 5.428796223446105,
      "deviationPct": 52.572400116400644,
      "z": -10.603343117379781,
      "flagged": true
    }
  ],
  "passage": {
    "marker": "first_person_rate",
    "startWord": 683,
    "endWord": 782,
    "value": 0,
    "note": "advisory - a diagnostic passage location, not a blocking verdict: the first_person_rate marker's most locally deviant 100-word window is words 683-782"
  }
}
```

`threshold` is the same value as the top-level `threshold` field, repeated here so the explain
block is self-contained. `perMarker` carries every marker from `markers` again, this time
ordered by `\|z\|` descending. `passage` is present whenever the scored text had at least one
word token; `null` only in the defensive case of a text that strips to zero words under
preprocessing (a heading-only file, for example).

When there are no chapters to scan, `--explain` states that rather than staying silent,
matching how this CLI already speaks in the same branch without the flag:

```
[stylometry] pass: no chapters to scan
  no chapters to scan; nothing to explain
```

### `--by-register` output

Advisory only (ADR-0012 voice verdict scope, Decision 4): never changes the exit code, and
carries the VERBATIM label `advisory - no blocking verdict at register scale; register-sized
text is far below the roughly 2,200 words a blocking verdict needs` wherever it appears (the
text-mode header and every JSON `registers[]` entry's `note`), so a reader can never mistake a
register comparison for a scored, blocking result. Real run (`ns-stylometry
--project=examples/sample-book --chapter=01-listening-before-speaking --by-register`, against
the shipped sample book's three registers - anecdotal, instructional, reflective):

```
[stylometry] pass: drift statistic 1.46 < calibrated threshold 3.67

Register comparison (advisory - no blocking verdict at register scale; register-sized text is far below the roughly 2,200 words a blocking verdict needs):

  anecdotal (sample_count 1):
    function_word_rate   deviation    1.51%  baseline 0.4923  measured 0.4848
    contraction_rate     deviation   34.38%  baseline 0.0930  measured 0.1250
    first_person_rate    deviation   34.65%  baseline 1.1592  measured 0.7576
    second_person_rate   deviation  226.77%  baseline 0.9274  measured 3.0303
    type_token_ratio     deviation    3.63%  baseline 0.7780  measured 0.7498
    avg_word_length      deviation    2.31%  baseline 4.8462  measured 4.9583
    avg_sentence_length  deviation   12.27%  baseline 15.0465  measured 13.2000
    punctuation_rate     deviation    2.11%  baseline 12.9830  measured 13.2576
```

(The two other registers, `instructional` and `reflective`, print the same shape and are
omitted here for length.) There is no `z` here and no combining rule: a register carries no
calibration ladder (`stylometry.registers.<name>` is a bare marker vector plus `sample_count`,
never a calibrated baseline), so there is nothing to standardize against - only the same honest,
signed-relative-deviation formula the verdict statistic itself starts from, per marker, with no
verdict at the end. When no registers are configured, `--by-register` prints a plain
explanation instead of a table (still exit 0, never silence):

```
no stylometry.registers configured in .studio/config.json; register-aware comparison is unavailable until nfs-capture-voice's optional register bucketing runs
```

With `--json --by-register`, the JSON gains a top-level `registers` array (one entry per
configured register: `{ register, sample_count, note, perMarker }`) or, when none are
configured, an empty array plus a `registersNote` string carrying the same explanation.

## Eight-marker vector

| Marker | Description |
|---|---|
| `function_word_rate` | Proportion of tokens that are function words (articles, prepositions, conjunctions) |
| `contraction_rate` | Proportion of SENTENCES that contain a contraction or apostrophe-bonded possessive (contractions divided by sentence count, not by token count) |
| `first_person_rate` | First-person pronouns (I, me, my, myself, we, us, our...) per hundred words |
| `second_person_rate` | Second-person pronouns (you, your, yourself...) per hundred words |
| `type_token_ratio` | Moving-average type-token ratio: the mean of the plain unique/total ratio over every sliding 100-token window, which makes it length-invariant by construction. Text shorter than or equal to one window falls back to the plain ratio over the whole text. |
| `avg_word_length` | Mean character length of all word tokens (no content-word filter -- function words are included) |
| `avg_sentence_length` | Mean word count per sentence |
| `punctuation_rate` | Punctuation characters per hundred words |

These eight are unchanged in meaning since `marker_set_version` 4; this wave's version bump (to
5) changed only the rule that judges a measured vector, not what any marker itself computes -
see the History comment on `CURRENT_MARKER_SET_VERSION` in `hooks/lib/stylometry-engine.mjs`
for the full version history.

## Example invocations

Run against all chapters in the current project:

```
ns-stylometry --json
```

Score a single chapter with the full explain breakdown:

```
ns-stylometry --chapter=01-listening-before-speaking --explain
```

Measure a chapter's raw vector with no baseline comparison (the `nfs-quick-scan` path):

```
ns-stylometry --measure=chapters/01-listening-before-speaking.md
```

Calibrate a fresh baseline from a voice corpus (the `nfs-capture-voice` path):

```
ns-stylometry --calibrate=context/samples/voice-corpus-01.md,context/samples/voice-corpus-02.md,context/samples/voice-corpus-03.md
```

## Calibration and `--calibrate`

`--calibrate` runs the five-rung ladder recipe over the given voice-corpus files and prints the
full baseline material (`markers`, `marker_set_version`, `calibration`) as JSON to stdout,
plus a plain-language regime disclosure to stderr (see below). It reads no config and writes
nothing - `nfs-capture-voice` is the only path that persists the result, via a read-modify-write
into `.studio/config.json` `stylometry.baseline` (see "Relationship to other CLIs", below).

**Cost.** Calibration draws 1,000 replicates at each of the five spans (calibration block plus
disjoint evaluation block, per rung) plus 1,000 ghostwritten replicates at the shortest span for
the regime call - 11,000 resampled text blocks in total, every one re-measured through the full
eight-marker vector. On a real run over the shipped sample book's ~3,500-word voice corpus
(three files), this took about 10 seconds wall-clock. Deterministic: byte-identical stdout for
byte-identical input files, because the seed (4242) is unconditional - there is no `--seed`
flag to vary it.

**Minimum corpus size.** At least `MIN_CALIBRATION_WORDS` (2,200 usable words, measured by the
canonical tokenizer) is required before calibration can run at all - this is independent of how
large a span is later drawn from the corpus, because every draw above 2,200 words is a weighted
resample WITH replacement from the corpus's own sentence pool, so a small corpus can legitimately
produce an 8,800-word draw by reusing its own sentences many times over. What a small corpus
genuinely cannot do is supply enough distinct material for the calibration and evaluation blocks
to say anything trustworthy about natural same-voice variation in the first place. Below the
floor, `--calibrate` exits 1 with a real message (`CorpusTooSmallError`, verified by a live run
against a 16-word file):

```
ns-stylometry: voice corpus has 16 usable word(s), measured by the canonical tokenizer; at least 2200 are needed to calibrate the five-rung noise-scale ladder (add more voice sample text, then recapture)
```

A corpus that clears 2,200 words on the tokenizer's own count but yields zero terminal-punctuated
sentences once markdown syntax is stripped (unpunctuated fragments, tables, code) hits the same
exit 1 with a different message naming that specific gap - calibration resamples whole
punctuated sentences, so at least one is required.

**Regime disclosure.** Calibration also decides which verdict scale the resulting baseline can
support (ADR-0012 voice verdict scope, Decision 2): the shortest rung's calibrated statistic, scored
against a synthesized ghostwritten positive class (the `ghostwriteTransform` in
`hooks/lib/stylometry-calibration.mjs` - contractions expanded, first- and second-person
pronouns converted to third-person plural; documented caveat: only this one drift type has been
measured, and a wholesale rewrite by a different author or an LLM paraphrase is untested and may
behave differently), yields a Mann-Whitney detectability AUC. At or above 0.95, the regime is
`"chapter"` - a per-chapter verdict is statistically supportable. Below it, the regime is
`"book"` - only a book-scale aggregate verdict is. This is written to stderr as two independent,
separately quotable sentences (real runs, verbatim):

```
ns-stylometry: regime = book. Detectability AUC 0.596 at the 550-word rung falls short of the 0.95 bar, so only a book-scale aggregate verdict is supportable.
```

```
ns-stylometry: regime = chapter. Detectability AUC 1.000 at the 550-word rung meets the 0.95 bar, so per-chapter verdicts are supportable.
```

**Real output** (`ns-stylometry --calibrate=` against the shipped sample book's three
voice-corpus files, 3,481 usable words, exit 0; two of the five `noise_scales` rungs shown, each
truncated to two markers of eight, for length only - every number below is the CLI's own real
output, unrounded; `files` is shown book-relative rather than the absolute local filesystem
paths the CLI actually printed, since an absolute path is not portable across machines):

```json
{
  "markers": {
    "function_word_rate": 0.5079000287273772,
    "contraction_rate": 0.10683760683760683,
    "first_person_rate": 0.6032749209997127,
    "second_person_rate": 2.4992818155702383,
    "type_token_ratio": 0.7563985807214673,
    "avg_word_length": 4.783395575983913,
    "avg_sentence_length": 14.876068376068377,
    "punctuation_rate": 12.81241022694628
  },
  "marker_set_version": 5,
  "calibration": {
    "spans": [550, 1100, 2200, 4400, 8800],
    "noise_scales": {
      "550": { "function_word_rate": 3.11754605132446, "contraction_rate": 58.8603086475439, "...": "...six more markers..." },
      "8800": { "function_word_rate": 0.7711410313884655, "contraction_rate": 15.560517460331429, "...": "...six more markers..." }
    },
    "block_thresholds": {
      "550": 3.6715903005384867,
      "1100": 3.5767581436798332,
      "2200": 4.1353955867352425,
      "4400": 4.865043719577832,
      "8800": 5.426881035982983
    },
    "detectability_auc": 0.59556,
    "regime": "book",
    "replicates": 1000,
    "seed": 4242
  },
  "files": ["context/samples/voice-corpus-01.md", "context/samples/voice-corpus-02.md", "context/samples/voice-corpus-03.md"],
  "totalWords": 3481
}
```

(The full ladder carries all five rungs, `550` through `8800`; two are shown above for brevity,
and each rung's `noise_scales` carries all eight markers, of which two are shown per rung.) Note
that `block_thresholds` is not monotonic across the ladder in this real example (3.67 at 550
words, dipping to 3.58 at 1,100, then climbing to 5.43 at 8,800) - each rung is the empirical
0.99 quantile of its own disjoint evaluation block, never a smooth formula, so a small dip
between adjacent rungs is expected sampling behavior, not a defect.

**The `method` field.** `nfs-capture-voice` writes one additional prose field,
`stylometry.baseline.method`, that this engine never prints: one sentence naming how the
baseline was produced (own samples versus bootstrapped generation, and roughly how many). It is
not doctor-checked - it exists so a human reading `config.json` later understands the baseline's
provenance without cross-referencing the capture skill. This is a blessed convention: every
baseline `nfs-capture-voice` writes carries it, but nothing in this engine reads or validates it.

## Regime and the two-tier gate policy

`ns-stylometry` reports `regime` (from the baseline's own `calibration.regime`) but never acts
on it: scoring mode always compares the raw statistic to the raw threshold at whatever word
count was scored, with no floor and no skip logic of its own - `ns-stylometry --all` against a
528-word single-chapter aggregate reports `exceeded` honestly at that word count, even though
the aggregate is far below a book-scale verdict's usable floor. The two-tier POLICY built on top
of this same statistic - per-chapter scoring with a `MIN_SCORABLE_CHAPTER_WORDS` (50-word) skip
floor in chapter regime, and a `MIN_BOOK_VERDICT_WORDS` (2,200-word) pass-with-advice floor in
book regime, worst-chapter selection by threshold ratio - lives in `hooks/lib/gate-engine.mjs`
and is exercised only through `bin/ns-gate`'s `stylometry` check, never through this CLI
directly. See the [ns-gate CLI reference](./ns-gate.md) for that policy.

## Deprecation: `thresholds.drift_score_max`

Retired by the calibrated-null verdict (ADR-0012 voice verdict scope, Decision 3) and read by
nothing for scoring - the threshold now comes entirely from the baseline's own calibration
ladder. A config that still carries the key is readable but ignored for one release: when
`computeDrift` sees it, it appends one canonical string to a `deprecations` array, which both
surfaces print once per run (verified live):

```
ns-stylometry: thresholds.drift_score_max is retired by the calibrated-null verdict and is ignored; remove it from config.json (it will be an error in a future release)
```

`bin/ns-gate`'s stylometry check appends the same string to its check `detail` once per run. It
will become an error in a future release; remove the key from `.studio/config.json` at your
convenience. `MARKER_CONTRIBUTION_DIVISOR` and `DEFAULT_DRIFT_SCORE_MAX`, artifacts of the
retired capped-sum rule, are gone entirely - no deprecation window for either, since nothing
outside the engine ever read them directly.

## Relationship to other CLIs

`ns-stylometry` shares the `countWords` tokenizer with `ns-doctor` (the single-tokenizer
authority per the 2026-07-18 banked adjudication). `bin/ns-gate` calls the stylometry engine
(`computeDrift`) as the `stylometry` gate check, applying the two-tier regime policy described
above on top of the same statistic this CLI reports directly. The `nfs-capture-voice` agent
calls `ns-stylometry --calibrate` to build the full baseline (markers plus calibration ladder)
that it then writes to `.studio/config.json`, and calls `ns-stylometry --measure` separately to
measure each optional register bucket's plain vector (registers carry no calibration - see
`--by-register`, above). `nfs-quick-scan` calls `ns-stylometry --measure` standalone, with no
book root and no baseline, for a project-free measurement of pasted prose.

## See also

- [ns-gate CLI reference](./ns-gate.md) - orchestrator that calls ns-stylometry internally, and owns the two-tier regime policy
- [nfs-capture-voice skill reference](../skills/nfs-capture-voice.md) - skill that builds the voice baseline via `--calibrate`
- [nfs-quick-scan skill reference](../skills/nfs-quick-scan.md) - skill that uses standalone `--measure`
- [MIGRATION.md](../../../MIGRATION.md) - the marker-set-5 mandatory-recapture note
