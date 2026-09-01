// tests/engines/stylometry-calibration.test.mjs
// what-it-is:   the golden drift-detection suite for the calibrated-null verdict statistic
//               (ADR-0012, voice verdict scope).
// what-it-does: this suite was rewritten, not patched, per ADR-0012's own recorded consequence.
//               The OLD suite asserted a per-chapter drift score against a hand-tuned budget
//               (DEFAULT_DRIFT_SCORE_MAX, MARKER_CONTRIBUTION_DIVISOR) -- both retired. Measured
//               on this implementation wave's own probe, that combining rule discriminated a
//               planted ghostwriting signature from ordinary chapter-to-chapter voice variation
//               at AUC 0.53 on real prose at chapter scale: a coin flip. It was not testing
//               whether drift detection works; it was testing how uniform one specific sample
//               book happens to be. computeDrift v5 replaces the combining rule with the largest
//               standardized deviation (max |z|) against a per-span noise-scale ladder measured
//               from the author's own voice corpus (hooks/lib/stylometry-engine.mjs,
//               hooks/lib/stylometry-calibration.mjs) -- this suite asserts THAT instrument's
//               behavior instead.
//
//               Two-tier truth (coordinator ruling on this task): the shipped sample book is
//               honestly a BOOK-regime voice -- its own calibration measures
//               detectability_auc 0.596 at the shortest rung, well under the 0.95 bar a
//               per-chapter verdict needs (hooks/lib/stylometry-calibration.mjs,
//               REGIME_AUC_THRESHOLD). At the approx 1,050 words its two real chapters actually
//               contain, the calibrated null is wide enough that even a genuine ghostwriting
//               transform does not cross threshold -- and this suite asserts that as a PINNED
//               PROPERTY, not a caveat: it is the measured reason this baseline's regime is
//               "book" and the gate's MIN_BOOK_VERDICT_WORDS floor (hooks/lib/gate-engine.mjs)
//               exists at all. The same ladder DOES separate ghostwritten from honest text once
//               enough scored words are on the table (the same measured marker rates, evaluated
//               at the ladder's higher rungs) -- proving the statistic's math is sound, not merely
//               that this one short demo happens to pass. The CHAPTER-regime block demonstration
//               (a voice that DOES clear the 0.95 bar, and DOES block a planted drift at chapter
//               scale) lives in examples/fixtures/voice-drift, its own calibrated author voice --
//               see tests/engines/gate.test.mjs and tests/engines/stylometry.test.mjs. This suite
//               does not duplicate that coverage.
//
//               No assertion in this file claims a chapter-scale or gate-blocking verdict for the
//               sample book: every scored-word count is stated explicitly, and the two per-chapter
//               numbers this suite reports (the honest-variance canary) are framed as advisory
//               statistics, matching how hooks/lib/gate-engine.mjs's book-regime branch carries
//               per-chapter statistics as advice that never affects the verdict ((local working notes, not published) P6).
// runner:       node --test tests/engines/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  measureChapter, measureBook, computeDrift, countWords,
} from '../../hooks/lib/stylometry-engine.mjs';
import { calibrateBaseline, ghostwriteTransform } from '../../hooks/lib/stylometry-calibration.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, 'fixtures', 'drift-scenarios');
const SAMPLE_BOOK = join(__dirname, '..', '..', 'examples', 'sample-book');
const SAMPLE_BOOK_CHAPTERS = join(SAMPLE_BOOK, 'chapters');
const SAMPLE_BOOK_SAMPLES = join(SAMPLE_BOOK, 'context', 'samples');

// The committed, frozen v5 baseline for this suite (markers + calibration ladder, corpus-
// calibrated from examples/sample-book's own independent voice corpus -- see SCENARIOS.md for
// full provenance). Deliberately read from this directory's own copy, not examples/sample-book's
// live config, so this suite is not silently re-scoped by an unrelated future edit to the shipped
// example's config.json.
const baseline = JSON.parse(readFileSync(join(FIXTURES, 'baseline.json'), 'utf8'));

// The two real, committed sample-book chapters -- read live, not a frozen copy, because the
// ghost-scenario assertions below require the REAL ghostwriteTransform applied to REAL chapter
// text (coordinator ruling: "not a hand-mangled string").
const ch1Text = readFileSync(join(SAMPLE_BOOK_CHAPTERS, '01-listening-before-speaking.md'), 'utf8');
const ch2Text = readFileSync(join(SAMPLE_BOOK_CHAPTERS, '02-finding-your-network.md'), 'utf8');

// ---------------------------------------------------------------------------
// Shared measurements, computed once and reused across the assertions below (each is a pure
// function of committed inputs, so sharing them does not couple the tests' outcomes to each
// other -- every test below still calls computeDrift itself with its own scoredWords).
// ---------------------------------------------------------------------------

const honestMeasured = measureBook([ch1Text, ch2Text]);
const honestScoredWords = countWords(ch1Text) + countWords(ch2Text);
const honestResult = computeDrift(honestMeasured, baseline, null, { scoredWords: honestScoredWords });

// The ghostwriting scenario: the REAL ghostwriteTransform (hooks/lib/stylometry-calibration.mjs
// -- the exact function calibrateBaseline itself uses to synthesize its positive class) applied
// directly to the REAL chapter text, then aggregated the same way measureBook aggregates any
// two-chapter book. Word count shifts slightly from the honest aggregate (1055 -> ghostScoredWords)
// because contraction expansion adds words ("I've" -> "I have").
const ghost1Text = ghostwriteTransform(ch1Text);
const ghost2Text = ghostwriteTransform(ch2Text);
const ghostMeasured = measureBook([ghost1Text, ghost2Text]);
const ghostScoredWords = countWords(ghost1Text) + countWords(ghost2Text);
const ghostResult = computeDrift(ghostMeasured, baseline, null, { scoredWords: ghostScoredWords });

// ---------------------------------------------------------------------------
// 1. Honest aggregate: two real, unmodified chapters, scored at book scale against the committed
//    baseline, must not spuriously block. This is the suite's basic sanity floor -- if this ever
//    fails, the calibration itself (not a scenario fixture) has drifted from the shipped voice.
// ---------------------------------------------------------------------------

test('honest aggregate (both real sample-book chapters, unmodified): PASS at book scale', () => {
  assert.strictEqual(honestResult.exceeded, false,
    'the unmodified two-chapter aggregate must not block against its own corpus-calibrated ' +
    'baseline; got statistic ' + honestResult.statistic.toFixed(4) + ' vs threshold ' +
    honestResult.threshold.toFixed(4) + ' at scoredWords ' + honestScoredWords);
});

// ---------------------------------------------------------------------------
// 2, 3, 4. The ghostwriting scenario, as three assertions from real measurements (coordinator
// ruling on this task's BLOCKED escalation -- see (local working notes, not published) for the full probe record).
// The plan's original "the ghostwriting scenario BLOCKS at book scale" acceptance criterion does
// not survive contact with this baseline's own honest smallness (the sample book's two chapters
// total ~1,050 words); rather than relabel the measured "does not block" result or hide it, the
// ruling reframes it as three separate, independently true properties.
// ---------------------------------------------------------------------------

test('ghost scenario, property 1 of 3 -- SEPARATION: ghost statistic exceeds honest statistic at each text\'s own real span', () => {
  assert.ok(ghostResult.statistic > honestResult.statistic,
    'the ghostwriting transform must move the statistic even where the calibrated null is too ' +
    'wide to support a block verdict; got ghost ' + ghostResult.statistic.toFixed(4) +
    ' (scoredWords ' + ghostScoredWords + ') vs honest ' + honestResult.statistic.toFixed(4) +
    ' (scoredWords ' + honestScoredWords + ') -- signal exists even where the verdict scale ' +
    'cannot support blocking');
});

test('ghost scenario, property 2 of 3 -- NON-BLOCK AT REAL SPAN IS A PINNED PROPERTY, not a caveat', () => {
  assert.strictEqual(ghostResult.exceeded, false,
    'ghost statistic ' + ghostResult.statistic.toFixed(4) + ' must stay under threshold ' +
    ghostResult.threshold.toFixed(4) + ' at the real scoredWords (' + ghostScoredWords + '). ' +
    'This is not a detection gap: it is the measured reason this baseline carries regime "' +
    baseline.calibration.regime + '" (detectability_auc ' +
    baseline.calibration.detectability_auc.toFixed(5) + ', see baseline.json -- well under the ' +
    '0.95 bar a chapter-scale verdict needs) and why the gate never trusts a verdict below its ' +
    'book-scale word floor. If a future engine change made this scenario block at ~1,050 words, ' +
    'this assertion SHOULD fail and force a look at what changed -- see property 3 below for ' +
    'where this same transform IS detectable.');
});

// ---------------------------------------------------------------------------
// Property 3 of 3 -- BLOCK AT EXTENDED SPANS: the SAME measured marker rates (the real ghost
// aggregate vector above, unchanged), evaluated with scoredWords set to the calibration ladder's
// own higher rungs, cross threshold -- while the honest rates at every rung on the ladder never
// do. This is a rates-sustained-at-span evaluation through computeDrift's scoredWords parameter:
// it asks "if this author had written enough words for the ladder's noise scale to tighten, would
// this same deviation register?", not "does resampling this short text up to a larger span
// produce a realistic longer ghostwritten chapter?" (it would not -- a synthetic resample from
// only these two chapters' ~78 sentences was measured, during this task's escalation, to break
// TYPE_TOKEN_RATIO for BOTH honest and ghostwritten resamples via sentence-reuse artifacts, which
// is exactly why this suite evaluates the real measured rates at each span rather than fabricating
// longer text; see (local working notes, not published) for that measurement).
// ---------------------------------------------------------------------------

const EXTENDED_BLOCK_SPANS = [4400, 8800];

for (const W of EXTENDED_BLOCK_SPANS) {
  test('ghost scenario, property 3 of 3 -- rates sustained at ' + W + ' scored words exceed threshold', () => {
    const result = computeDrift(ghostMeasured, baseline, null, { scoredWords: W });
    assert.strictEqual(result.exceeded, true,
      'the ghost aggregate\'s real measured marker rates, evaluated at scoredWords ' + W +
      ' via the calibration ladder, must exceed threshold: got statistic ' +
      result.statistic.toFixed(4) + ' vs threshold ' + result.threshold.toFixed(4));
  });
}

test('honest rates never exceed threshold at any rung on the calibration ladder', () => {
  for (const W of baseline.calibration.spans) {
    const result = computeDrift(honestMeasured, baseline, null, { scoredWords: W });
    assert.strictEqual(result.exceeded, false,
      'the honest aggregate\'s real measured marker rates must not exceed threshold at any ' +
      'ladder rung; got statistic ' + result.statistic.toFixed(4) + ' vs threshold ' +
      result.threshold.toFixed(4) + ' at scoredWords ' + W);
  }
});

// ---------------------------------------------------------------------------
// Honest-variance canary (regression guard): the per-chapter statistic for each real, honest
// chapter, reported ADVISORY -- matching hooks/lib/gate-engine.mjs's own book-regime handling,
// where per-chapter statistics are computed and carried as advice and never decide the verdict
// ((local working notes, not published) P6). This is not a chapter-scale verdict claim; it is a bound on a number the gate
// already reports for advice, so an engine change that quietly widens per-chapter drift for this
// voice gets caught here before it reaches a renderer.
// ---------------------------------------------------------------------------

const HONEST_CANARY_MULTIPLE = 1.5;

test('honest-variance canary: no honest sample-book chapter\'s advisory per-chapter statistic exceeds 1.5x its own threshold', () => {
  for (const [label, text] of [
    ['01-listening-before-speaking.md', ch1Text],
    ['02-finding-your-network.md', ch2Text],
  ]) {
    const scoredWords = countWords(text);
    const result = computeDrift(measureChapter(text), baseline, null, { scoredWords });
    const bound = HONEST_CANARY_MULTIPLE * result.threshold;
    assert.ok(result.statistic <= bound,
      label + ': advisory per-chapter statistic ' + result.statistic.toFixed(4) +
      ' must stay at or under 1.5x its threshold (' + bound.toFixed(4) + '); got ratio ' +
      (result.statistic / result.threshold).toFixed(4));
  }
});

// ---------------------------------------------------------------------------
// Determinism: recalibrating from the three committed voice-corpus files, in this test process,
// must reproduce BOTH the committed drift-scenarios baseline.json AND examples/sample-book's own
// config.json baseline (markers + calibration only -- captured/sample_count/method are agent-
// written per config.json's own read-modify-write contract, not measured, so they are excluded
// from this comparison by construction: only fields calibrateBaseline actually returns are
// compared). This is the guard that catches accidental corpus or seed drift -- a bad merge, a
// stale re-export, a corpus file edited without recapturing.
//
// "Byte-for-byte" cashes out here as JSON.stringify equality on the exact substructures
// calibrateBaseline returns, both sides serialized identically in this test (rather than a raw
// file-bytes diff, which would also be sensitive to how the committed files happen to be pretty-
// printed on disk -- a formatting concern this determinism guard is not testing). Because
// JSON.stringify on a number requires bit-identical floats to agree, this is exact reproduction,
// not an approximation.
//
// Fallback (pre-authorized, unused on this run): if this ever fails ONLY on a Windows CI leg
// (float or line-ending exposure), the recorded fallback is deep-equality on parsed values with a
// comment saying why, never deletion. Measured on this task's own Windows run: strict string
// equality passed cleanly, so the fallback is not invoked.
// ---------------------------------------------------------------------------

test('determinism: recalibrating from the committed voice corpus reproduces the committed baselines byte-for-byte', () => {
  const corpusTexts = ['voice-corpus-01.md', 'voice-corpus-02.md', 'voice-corpus-03.md']
    .map((f) => readFileSync(join(SAMPLE_BOOK_SAMPLES, f), 'utf8'));
  const recalibrated = calibrateBaseline(corpusTexts);

  const sampleBookConfig = JSON.parse(
    readFileSync(join(SAMPLE_BOOK, '.studio', 'config.json'), 'utf8')
  );
  const sampleBookBaseline = sampleBookConfig.stylometry.baseline;

  assert.strictEqual(JSON.stringify(recalibrated.markers), JSON.stringify(baseline.markers),
    'recalibrated markers must reproduce fixtures/drift-scenarios/baseline.json exactly');
  assert.strictEqual(JSON.stringify(recalibrated.calibration), JSON.stringify(baseline.calibration),
    'recalibrated calibration ladder must reproduce fixtures/drift-scenarios/baseline.json exactly');
  assert.strictEqual(JSON.stringify(recalibrated.markers), JSON.stringify(sampleBookBaseline.markers),
    'recalibrated markers must reproduce examples/sample-book/.studio/config.json exactly');
  assert.strictEqual(JSON.stringify(recalibrated.calibration), JSON.stringify(sampleBookBaseline.calibration),
    'recalibrated calibration ladder must reproduce examples/sample-book/.studio/config.json exactly');
});
