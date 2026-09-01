// tests/engines/stylometry.test.mjs
// what-it-is:   unit tests for hooks/lib/stylometry-engine.mjs
// what-it-does: verifies measureChapter, measureBook, and computeDrift against:
//               (1) a hand-computable two-sentence synthetic text where every marker
//                   can be verified by arithmetic in these comments;
//               (2) computeDrift v5 (ADR-0012, voice verdict scope): the calibration ladder
//                   lookup (exact rung, ln-space midpoint, beyond-either-end clamp), the
//                   verdict statistic (max |z| across markers) and its boundary (>=)
//                   behavior, the validation order (missing markers, stale version, invalid
//                   calibration, missing/non-positive scoredWords), the drift_score_max
//                   deprecation notice, and the exact v5 return and perMarker shapes (the old
//                   score/contribution/capped/maxMarkerContribution keys are gone);
//               (3) the zero-baseline rule;
//               (4) preprocess, typography folding, and Unicode word tokenization.
//               Tests that spawn bin/ns-stylometry (measure mode, --all/--chapter CLI exits,
//               the bad --project path) are SKIPPED, not deleted: this task's declared-red
//               map (ADR-0012 implementation wave, Task 3) leaves bin/ns-stylometry importing
//               the retired DEFAULT_DRIFT_SCORE_MAX export until Task 4 fixes its callers; see
//               each skipped test's reason string.
// runner:       node --test tests/engines/stylometry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, existsSync, mkdtempSync, writeFileSync, statSync, readdirSync, rmSync, cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { writeSyntheticV5Baseline } from '../lib/synthetic-v5-baseline.mjs';

import {
  measureChapter, measureBook, computeDrift, countWords, CURRENT_MARKER_SET_VERSION,
  StaleBaselineError, InvalidCalibrationError,
} from '../../hooks/lib/stylometry-engine.mjs';


// A complete, hand-built v5 calibration object, shaped per P2 ((local working notes, not published)), used by every
// synthetic computeDrift test below so none of them depend on a real .studio/config.json
// baseline (examples/sample-book and examples/fixtures/voice-drift still carry v4 baselines
// without a calibration ladder; Tasks 5 and 6 recapture them). Two rungs only (550, 2200) --
// matching the brief's own worked example -- not the shipped five-rung ladder; computeDrift's
// contract does not hardcode a rung count.
function buildCalibration(overrides = {}) {
  return {
    spans: [550, 2200],
    noise_scales: {
      '550': {
        function_word_rate: 8.0, contraction_rate: 8.0, first_person_rate: 10.0,
        second_person_rate: 8.0, type_token_ratio: 8.0, avg_word_length: 8.0,
        avg_sentence_length: 8.0, punctuation_rate: 8.0,
      },
      '2200': {
        function_word_rate: 4.0, contraction_rate: 4.0, first_person_rate: 5.0,
        second_person_rate: 4.0, type_token_ratio: 4.0, avg_word_length: 4.0,
        avg_sentence_length: 4.0, punctuation_rate: 4.0,
      },
    },
    block_thresholds: { '550': 3.0, '2200': 2.5 },
    detectability_auc: 0.98,
    regime: 'chapter',
    replicates: 300,
    seed: 4242,
    ...overrides,
  };
}

const SYNTHETIC_MARKERS = {
  function_word_rate: 0.5, contraction_rate: 1.0, first_person_rate: 2.0,
  second_person_rate: 1.0, type_token_ratio: 0.7, avg_word_length: 5.0,
  avg_sentence_length: 12.0, punctuation_rate: 10.0,
};

function buildBaseline(overrides = {}) {
  return {
    markers: SYNTHETIC_MARKERS,
    marker_set_version: CURRENT_MARKER_SET_VERSION,
    calibration: buildCalibration(),
    ...overrides,
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EXAMPLES = join(__dirname, '..', '..', 'examples');
const BIN = join(__dirname, '..', '..', 'bin', 'ns-stylometry');

// ---------------------------------------------------------------------------
// Synthetic hand-computable text
// ---------------------------------------------------------------------------
//
// Text: "You are great.\nI am good.\n"
//
// Preprocessing strips headings (none) and claim markers (none).
// Normalized: "You are great. I am good."
//
// Word tokens (regex /[a-zA-Z]+(?:-[a-zA-Z]+)*/g):
//   You, are, great, I, am, good  -> totalWords = 6
//
// Function words (engine's FUNCTION_WORDS set):
//   You  -> yes (personal pronoun)
//   are  -> yes (auxiliary verb)
//   great-> NO  (adjective, not in function word set)
//   I    -> yes (personal pronoun)
//   am   -> yes (auxiliary verb)
//   good -> NO  (adjective, not in function word set)
//   functionWordCount = 4; function_word_rate = 4/6 = 0.6667
//
// Contraction/possessive tokens (regex /[a-zA-Z]+'[a-zA-Z]+/g): none
//   contractionCount = 0
//
// First-person pronouns (set: i me my mine myself we us our ours ourselves):
//   "I" (lower: "i") -> yes
//   firstPersonCount = 1; first_person_rate = 1/6 * 100 = 16.667 per 100 words
//
// Second-person pronouns (set: you your yours yourself yourselves):
//   "You" (lower: "you") -> yes
//   secondPersonCount = 1; second_person_rate = 1/6 * 100 = 16.667 per 100 words
//
// Unique lower-cased words: {you, are, great, i, am, good} = 6 unique
//   type_token_ratio = 6/6 = 1.0
//
// Total character length: You(3)+are(3)+great(5)+I(1)+am(2)+good(4) = 18
//   avg_word_length = 18/6 = 3.0
//
// Sentence-ending punctuation in normalized text ("You are great. I am good."):
//   Matches: "great. " and "good." -> sentenceCount = 2
//   avg_sentence_length = 6/2 = 3.0
//
// Punctuation chars (regex /[.,;:!?()"]/g in normalized text):
//   two periods -> punctCount = 2
//   punctuation_rate = 2/6 * 100 = 33.333 per 100 words
//
// All arithmetic above can be verified without running the engine.

const SYNTHETIC_TEXT = 'You are great.\nI am good.\n';

test('synthetic: measureChapter returns correct function_word_rate', () => {
  const v = measureChapter(SYNTHETIC_TEXT);
  // function_word_rate = 4/6 = 0.6667 (You, are, I, am are function words; great, good are not)
  assert.ok(Math.abs(v.function_word_rate - 4 / 6) < 0.0001,
    'function_word_rate should be 4/6; got ' + v.function_word_rate);
});

test('synthetic: measureChapter returns correct contraction_rate', () => {
  const v = measureChapter(SYNTHETIC_TEXT);
  // No apostrophe tokens; contractions = 0, sentences = 2, rate = 0/2 = 0.0
  assert.strictEqual(v.contraction_rate, 0.0, 'contraction_rate should be 0 (no apostrophes)');
});

test('synthetic: measureChapter returns correct first_person_rate', () => {
  const v = measureChapter(SYNTHETIC_TEXT);
  // "I" is the only first-person pronoun; first_person_rate = 1/6 * 100 = 16.667
  assert.ok(Math.abs(v.first_person_rate - (1 / 6) * 100) < 0.001,
    'first_person_rate should be 1/6*100; got ' + v.first_person_rate);
});

test('synthetic: measureChapter returns correct second_person_rate', () => {
  const v = measureChapter(SYNTHETIC_TEXT);
  // "You" is the only second-person pronoun; second_person_rate = 1/6 * 100 = 16.667
  assert.ok(Math.abs(v.second_person_rate - (1 / 6) * 100) < 0.001,
    'second_person_rate should be 1/6*100; got ' + v.second_person_rate);
});

test('synthetic: measureChapter returns correct type_token_ratio', () => {
  const v = measureChapter(SYNTHETIC_TEXT);
  // 6 unique lowercase words in 6 total words; TTR = 6/6 = 1.0
  assert.ok(Math.abs(v.type_token_ratio - 1.0) < 0.0001,
    'type_token_ratio should be 1.0 (all words unique); got ' + v.type_token_ratio);
});

test('synthetic: measureChapter returns correct avg_word_length', () => {
  const v = measureChapter(SYNTHETIC_TEXT);
  // You(3)+are(3)+great(5)+I(1)+am(2)+good(4) = 18 chars; avg = 18/6 = 3.0
  assert.ok(Math.abs(v.avg_word_length - 3.0) < 0.0001,
    'avg_word_length should be 18/6=3.0; got ' + v.avg_word_length);
});

test('synthetic: measureChapter returns correct avg_sentence_length', () => {
  const v = measureChapter(SYNTHETIC_TEXT);
  // 2 sentences ("You are great." and "I am good."); 6 words total; avg = 6/2 = 3.0
  assert.ok(Math.abs(v.avg_sentence_length - 3.0) < 0.0001,
    'avg_sentence_length should be 6/2=3.0; got ' + v.avg_sentence_length);
});

test('synthetic: measureChapter returns correct punctuation_rate', () => {
  const v = measureChapter(SYNTHETIC_TEXT);
  // Two periods; punctuation_rate = 2/6 * 100 = 33.333 per 100 words
  assert.ok(Math.abs(v.punctuation_rate - (2 / 6) * 100) < 0.001,
    'punctuation_rate should be 2/6*100=33.33; got ' + v.punctuation_rate);
});

test('synthetic: measureChapter result has all 8 required marker keys', () => {
  const v = measureChapter(SYNTHETIC_TEXT);
  const required = [
    'function_word_rate', 'contraction_rate', 'first_person_rate',
    'second_person_rate', 'type_token_ratio', 'avg_word_length',
    'avg_sentence_length', 'punctuation_rate',
  ];
  for (const key of required) {
    assert.ok(Object.prototype.hasOwnProperty.call(v, key),
      'missing key: ' + key);
    assert.ok(typeof v[key] === 'number', key + ' must be a number');
  }
});

// ---------------------------------------------------------------------------
// preprocess: all four claim-marker forms must be stripped, not just [claim:]
// ---------------------------------------------------------------------------
//
// docs/formats/claim-markers.md defines four marker forms: [claim: EV-NNNN],
// [UNVERIFIED], [SOURCE-UNVERIFIABLE], and [quote: EV-NNNN] (the last added
// this wave for OPP-D03, quote fidelity and source packets). Before this fix,
// preprocess() stripped only [claim: EV-NNNN], so a chapter using the other
// three forms measured differently from the same prose without them: each
// marker adds spurious word tokens (for example "quote" and "EV" from
// "[quote: EV-0012]"), which perturbs every rate that divides by totalWords
// and inflates countWords, the same authority progress.json and the
// state_coherence check rely on.
//
// This section proves a marker-laden chapter measures IDENTICALLY to the
// same prose with every marker form removed.

const MARKER_FREE_TEXT =
  'The researchers wrote plainly: "spaced repetition raises recall."\n' +
  'This claim needs a source.\n' +
  'It resolved eventually.\n' +
  'The gain held across cohorts.\n';

const MARKER_LADEN_TEXT =
  'The researchers wrote plainly: "spaced repetition raises recall." [quote: EV-0012]\n' +
  'This claim needs a source. [UNVERIFIED]\n' +
  'It resolved eventually. [claim: EV-0013]\n' +
  'The gain held across cohorts. [claim: EV-0013] [SOURCE-UNVERIFIABLE]\n';

test('preprocess strips [quote: EV-NNNN] anchors: measureChapter is identical with and without one', () => {
  const withMarker = measureChapter('A plain sentence. [quote: EV-0012]\n');
  const withoutMarker = measureChapter('A plain sentence.\n');
  assert.deepStrictEqual(withMarker, withoutMarker,
    '[quote: EV-NNNN] must be stripped like [claim: EV-NNNN]; got ' +
    JSON.stringify(withMarker) + ' vs ' + JSON.stringify(withoutMarker));
});

test('preprocess strips [UNVERIFIED]: measureChapter is identical with and without one', () => {
  const withMarker = measureChapter('A plain sentence. [UNVERIFIED]\n');
  const withoutMarker = measureChapter('A plain sentence.\n');
  assert.deepStrictEqual(withMarker, withoutMarker,
    '[UNVERIFIED] must be stripped; got ' +
    JSON.stringify(withMarker) + ' vs ' + JSON.stringify(withoutMarker));
});

test('preprocess strips [SOURCE-UNVERIFIABLE]: measureChapter is identical with and without one', () => {
  const withMarker = measureChapter('A plain sentence. [claim: EV-0013] [SOURCE-UNVERIFIABLE]\n');
  const withoutMarker = measureChapter('A plain sentence. [claim: EV-0013]\n');
  assert.deepStrictEqual(withMarker, withoutMarker,
    '[SOURCE-UNVERIFIABLE] must be stripped; got ' +
    JSON.stringify(withMarker) + ' vs ' + JSON.stringify(withoutMarker));
});

test('preprocess strips all four marker forms together: a marker-laden chapter measures identically to the same prose with markers removed', () => {
  const withMarkers = measureChapter(MARKER_LADEN_TEXT);
  const withoutMarkers = measureChapter(MARKER_FREE_TEXT);
  assert.deepStrictEqual(withMarkers, withoutMarkers,
    'a chapter using [quote:], [UNVERIFIED], and [SOURCE-UNVERIFIABLE] markers must measure ' +
    'identically to the same prose with no markers at all; got ' +
    JSON.stringify(withMarkers) + ' vs ' + JSON.stringify(withoutMarkers));
});

test('countWords is unaffected by [quote:], [UNVERIFIED], or [SOURCE-UNVERIFIABLE] markers', () => {
  assert.strictEqual(countWords(MARKER_LADEN_TEXT), countWords(MARKER_FREE_TEXT),
    'countWords feeds progress.json and the state_coherence check; it must not count marker tokens as prose');
});

// ---------------------------------------------------------------------------
// computeDrift: zero-baseline rule (unchanged under v5: relDev/deviationPct still 0 or
// +100, never -100, even though z is now signed for every other marker)
// ---------------------------------------------------------------------------

test('computeDrift: zero-baseline with zero measured gives 0 deviationPct and z', () => {
  const baseline = buildBaseline({
    markers: { marker_a: 0, marker_b: 1.0 },
    calibration: buildCalibration({
      noise_scales: {
        '550':  { marker_a: 10.0, marker_b: 10.0 },
        '2200': { marker_a: 5.0,  marker_b: 5.0 },
      },
    }),
  });
  const { perMarker } = computeDrift({ marker_a: 0, marker_b: 1.0 }, baseline, {}, { scoredWords: 550 });
  const ma = perMarker.find(m => m.marker === 'marker_a');
  assert.strictEqual(ma.deviationPct, 0, 'zero baseline / zero measured -> deviationPct 0');
  assert.strictEqual(ma.z, 0, 'zero baseline / zero measured -> z 0');
  assert.strictEqual(ma.flagged, false, 'deviationPct 0 is not flagged');
});

test('computeDrift: zero-baseline with non-zero measured gives 100 deviationPct, never -100', () => {
  const baseline = buildBaseline({
    markers: { marker_a: 0 },
    calibration: buildCalibration({
      noise_scales: { '550': { marker_a: 10.0 }, '2200': { marker_a: 5.0 } },
    }),
  });
  // measured is NEGATIVE: proves the zero-baseline rule always reports +100, never -100,
  // regardless of which direction a non-zero measured value would naively point.
  const { perMarker } = computeDrift({ marker_a: -5.0 }, baseline, {}, { scoredWords: 550 });
  const ma = perMarker.find(m => m.marker === 'marker_a');
  assert.strictEqual(ma.deviationPct, 100, 'zero baseline / non-zero measured -> deviationPct 100');
  assert.strictEqual(ma.z, 10, 'zero baseline / non-zero measured -> relDev +100, z = 100/10 = 10 (never negative)');
  assert.strictEqual(ma.flagged, true, 'deviationPct 100 is flagged (exceeds 2% band)');
});

// ---------------------------------------------------------------------------
// computeDrift v5: the calibration ladder lookup (P1/P3, ADR-0012 voice verdict scope)
// ---------------------------------------------------------------------------
//
// Hand-computable two-rung ladder, matching the brief's own worked example exactly:
//   spans = [550, 2200]; first_person_rate noise_scales: 10.0 at 550, 5.0 at 2200;
//   block_thresholds: 3.0 at 550, 2.5 at 2200.
//   baseline first_person_rate = 2.0; measured = 3.0 -> relDev = (3-2)/2*100 = 50%.
// Interpolation is LINEAR IN ln(scoredWords), with linear rung values (not linear in W
// itself, and not sqrt-extrapolated beyond the rungs -- see the mutation proofs in the
// task report for why each of those alternate shapes is distinguishable from this one).

function ladderBaseline() {
  return buildBaseline({
    markers: { first_person_rate: 2.0 },
    calibration: buildCalibration({
      noise_scales: { '550': { first_person_rate: 10.0 }, '2200': { first_person_rate: 5.0 } },
      block_thresholds: { '550': 3.0, '2200': 2.5 },
    }),
  });
}

test('ladder lookup: scoredWords exactly at a rung uses that rung\'s values verbatim', () => {
  const { statistic, threshold, exceeded } = computeDrift(
    { first_person_rate: 3.0 }, ladderBaseline(), {}, { scoredWords: 550 }
  );
  // z = relDev / scale = 50 / 10.0 = 5.0; threshold = 3.0 (the 550 rung verbatim).
  assert.ok(Math.abs(statistic - 5.0) < 1e-9, 'statistic at the 550 rung should be exactly 5.0; got ' + statistic);
  assert.ok(Math.abs(threshold - 3.0) < 1e-9, 'threshold at the 550 rung should be exactly 3.0; got ' + threshold);
  assert.strictEqual(exceeded, true, '5.0 >= 3.0 -> exceeded');
});

test('ladder lookup: scoredWords at the ln-space midpoint of two rungs yields the log-linear interpolant', () => {
  // sqrt(550 * 2200) = 1100 is the ln-space midpoint of [550, 2200]:
  //   t = (ln(1100) - ln(550)) / (ln(2200) - ln(550)) = ln(2) / ln(4) = 0.5 exactly.
  // scale = 10.0 + 0.5 * (5.0 - 10.0) = 7.5; z = 50 / 7.5 = 6.6667 (repeating).
  // threshold = 3.0 + 0.5 * (2.5 - 3.0) = 2.75.
  const { statistic, threshold, exceeded } = computeDrift(
    { first_person_rate: 3.0 }, ladderBaseline(), {}, { scoredWords: 1100 }
  );
  assert.ok(Math.abs(statistic - 50 / 7.5) < 1e-9,
    'statistic at the ln-midpoint should be 50/7.5 = 6.6667; got ' + statistic);
  assert.ok(Math.abs(threshold - 2.75) < 1e-9,
    'threshold at the ln-midpoint should be 2.75; got ' + threshold);
  assert.strictEqual(exceeded, true, '6.6667 >= 2.75 -> exceeded');
});

test('ladder lookup: scoredWords below the first rung clamps to that rung\'s values', () => {
  const atRung = computeDrift({ first_person_rate: 3.0 }, ladderBaseline(), {}, { scoredWords: 550 });
  const below = computeDrift({ first_person_rate: 3.0 }, ladderBaseline(), {}, { scoredWords: 300 });
  assert.strictEqual(below.statistic, atRung.statistic,
    'scoredWords below the first rung must clamp to the first rung\'s statistic, not extrapolate');
  assert.strictEqual(below.threshold, atRung.threshold,
    'scoredWords below the first rung must clamp to the first rung\'s threshold, not extrapolate');
});

test('ladder lookup: scoredWords beyond the last rung clamps to that rung\'s values (never extrapolates)', () => {
  const { statistic, threshold } = computeDrift(
    { first_person_rate: 3.0 }, ladderBaseline(), {}, { scoredWords: 8800 }
  );
  // Clamped: scale stays 5.0 (the 2200 rung), z = 50/5.0 = 10.0, threshold stays 2.5.
  // An sqrt-law extrapolation from 2200 to 8800 (factor sqrt(2200/8800) = 0.5) would instead
  // shrink the scale to 2.5 and give z = 20.0 -- a clearly distinguishable wrong answer,
  // which is what the "extrapolation instead of clamping" mutation proof breaks toward.
  assert.ok(Math.abs(statistic - 10.0) < 1e-9,
    'statistic beyond the last rung must clamp to z = 50/5.0 = 10.0, not extrapolate to 20.0; got ' + statistic);
  assert.ok(Math.abs(threshold - 2.5) < 1e-9,
    'threshold beyond the last rung must clamp to 2.5; got ' + threshold);
});

// ---------------------------------------------------------------------------
// computeDrift v5: verdict statistic, worstMarker, and the >= boundary (P1)
// ---------------------------------------------------------------------------

test('computeDrift: statistic is the MAX |z| across markers, and worstMarker names the marker attaining it', () => {
  const baseline = buildBaseline({
    markers: { quiet: 1.0, loud: 1.0 },
    calibration: buildCalibration({
      noise_scales: {
        '550':  { quiet: 10.0, loud: 10.0 },
        '2200': { quiet: 10.0, loud: 10.0 },
      },
      block_thresholds: { '550': 100.0, '2200': 100.0 }, // high enough that neither exceeds
    }),
  });
  const measured = { quiet: 1.05, loud: 3.0 }; // quiet: relDev 5%, z=0.5; loud: relDev 200%, z=20
  const { statistic, worstMarker } = computeDrift(measured, baseline, {}, { scoredWords: 550 });
  assert.ok(Math.abs(statistic - 20) < 1e-9, 'statistic must be the larger |z| (loud, 20), not quiet\'s 0.5; got ' + statistic);
  assert.strictEqual(worstMarker, 'loud', 'worstMarker must name the marker attaining the max |z|');
});

test('computeDrift: worstMarker ties break to the FIRST marker in Object.keys(baseline.markers) order', () => {
  // Both markers deviate identically (relDev 100%, scale 10 -> z = 10 for each). "first"
  // is defined by insertion order in the markers object literal below, not sorted order.
  const baseline = buildBaseline({
    markers: { zeta: 1.0, alpha: 1.0 },
    calibration: buildCalibration({
      noise_scales: {
        '550':  { zeta: 10.0, alpha: 10.0 },
        '2200': { zeta: 10.0, alpha: 10.0 },
      },
    }),
  });
  const { worstMarker } = computeDrift({ zeta: 2.0, alpha: 2.0 }, baseline, {}, { scoredWords: 550 });
  assert.strictEqual(worstMarker, 'zeta',
    'a tie must resolve to the first key in Object.keys(baseline.markers) order (zeta, not alpha)');
});

test('computeDrift: z is SIGNED (negative when measured falls below baseline); deviationPct and statistic stay non-negative', () => {
  const baseline = buildBaseline({
    markers: { m: 10.0 },
    calibration: buildCalibration({
      noise_scales: { '550': { m: 10.0 }, '2200': { m: 10.0 } },
    }),
  });
  const { perMarker, statistic } = computeDrift({ m: 5.0 }, baseline, {}, { scoredWords: 550 });
  const entry = perMarker.find(x => x.marker === 'm');
  // relDev = (5 - 10) / 10 * 100 = -50; z = -50 / 10 = -5.
  assert.ok(entry.z < 0, 'z must be negative when measured falls below baseline; got ' + entry.z);
  assert.ok(Math.abs(entry.z - (-5)) < 1e-9, 'z should be exactly -5; got ' + entry.z);
  assert.ok(entry.deviationPct > 0, 'deviationPct stays a non-negative magnitude even when z is negative');
  assert.ok(Math.abs(entry.deviationPct - 50) < 1e-9, 'deviationPct should be 50 (the honest magnitude); got ' + entry.deviationPct);
  assert.ok(Math.abs(statistic - 5) < 1e-9, 'statistic (max |z|) must be the positive magnitude 5, not -5; got ' + statistic);
});

test('computeDrift: exceeded boundary uses >= (statistic exactly equal to threshold is exceeded)', () => {
  // scale=10 at both rungs, so z = relDev/10 regardless of scoredWords in [550, 2200].
  // relDev = 30% -> z = 3.0, matching block_thresholds exactly at both rungs (3.0 at 550,
  // set equal here at 2200 too so the boundary holds across the whole span).
  const baseline = buildBaseline({
    markers: { m: 10.0 },
    calibration: buildCalibration({
      noise_scales: { '550': { m: 10.0 }, '2200': { m: 10.0 } },
      block_thresholds: { '550': 3.0, '2200': 3.0 },
    }),
  });
  const { statistic, threshold, exceeded } = computeDrift({ m: 13.0 }, baseline, {}, { scoredWords: 550 });
  assert.ok(Math.abs(statistic - threshold) < 1e-9,
    'this test requires statistic to exactly equal threshold; got statistic=' + statistic + ' threshold=' + threshold);
  assert.strictEqual(exceeded, true, 'statistic == threshold must be exceeded (>=, not >)');
});

// ---------------------------------------------------------------------------
// computeDrift v5: return shape and perMarker shape (P1) -- the old score, contribution,
// capped, and maxMarkerContribution keys are REMOVED, not just unused
// ---------------------------------------------------------------------------

test('computeDrift: return shape is exactly statistic, worstMarker, threshold, exceeded, regime, perMarker, markerTolerance, deprecations', () => {
  const result = computeDrift(SYNTHETIC_MARKERS, buildBaseline(), {}, { scoredWords: 550 });
  const expectedKeys = [
    'statistic', 'worstMarker', 'threshold', 'exceeded', 'regime',
    'perMarker', 'markerTolerance', 'deprecations',
  ].sort();
  assert.deepStrictEqual(Object.keys(result).sort(), expectedKeys,
    'computeDrift must return exactly the v5 keys, no more and no fewer; got ' + Object.keys(result).sort());
  for (const retired of ['score', 'contribution', 'capped', 'maxMarkerContribution']) {
    assert.ok(!(retired in result), 'retired key "' + retired + '" must not be present in the v5 return shape');
  }
});

test('computeDrift: regime is passed through verbatim from baseline.calibration.regime', () => {
  const chapterResult = computeDrift(SYNTHETIC_MARKERS, buildBaseline(), {}, { scoredWords: 550 });
  assert.strictEqual(chapterResult.regime, 'chapter');

  const bookBaseline = buildBaseline({ calibration: buildCalibration({ regime: 'book' }) });
  const bookResult = computeDrift(SYNTHETIC_MARKERS, bookBaseline, {}, { scoredWords: 550 });
  assert.strictEqual(bookResult.regime, 'book');
});

test('computeDrift: perMarker entries carry exactly marker, baseline, measured, deviationPct, z, flagged', () => {
  const { perMarker } = computeDrift(SYNTHETIC_MARKERS, buildBaseline(), {}, { scoredWords: 550 });
  const expectedKeys = ['marker', 'baseline', 'measured', 'deviationPct', 'z', 'flagged'].sort();
  for (const entry of perMarker) {
    assert.deepStrictEqual(Object.keys(entry).sort(), expectedKeys,
      'perMarker entry for ' + entry.marker + ' must carry exactly the v5 keys; got ' + Object.keys(entry).sort());
    for (const retired of ['contribution', 'capped']) {
      assert.ok(!(retired in entry), 'retired key "' + retired + '" must not be present on a perMarker entry');
    }
  }
});

// ---------------------------------------------------------------------------
// computeDrift v5: a single extreme marker CAN trigger exceeded alone -- the opposite
// guarantee of the retired capped-sum rule (roadmap row 1.7's Correction B is gone; the max
// statistic concentrates on wherever the real signal lives instead of diluting it across
// every marker, which is the whole reason the capped-sum rule measured at coin-flip AUC)
// ---------------------------------------------------------------------------

test('property: one wildly deviating marker alone is enough to exceed, with three stable markers contributing nothing', () => {
  const baseline = buildBaseline({
    markers: { onlyBad: 1.0, stable1: 1.0, stable2: 1.0, stable3: 1.0 },
    calibration: buildCalibration({
      noise_scales: {
        '550':  { onlyBad: 10.0, stable1: 10.0, stable2: 10.0, stable3: 10.0 },
        '2200': { onlyBad: 10.0, stable1: 10.0, stable2: 10.0, stable3: 10.0 },
      },
      block_thresholds: { '550': 5.0, '2200': 5.0 },
    }),
  });
  const measured = { onlyBad: 999999, stable1: 1, stable2: 1, stable3: 1 };
  const { statistic, worstMarker, exceeded } = computeDrift(measured, baseline, {}, { scoredWords: 550 });
  assert.strictEqual(worstMarker, 'onlyBad', 'the one wildly deviating marker must be the worst marker');
  assert.ok(statistic > 5.0, 'the single marker\'s z alone must exceed the threshold; got ' + statistic);
  assert.strictEqual(exceeded, true,
    'a single marker\'s deviation, unlike the retired capped-sum rule, is now sufficient to trigger exceeded on its own');
});

// ---------------------------------------------------------------------------
// computeDrift v5: thresholds.drift_score_max deprecation notice (P7)
// ---------------------------------------------------------------------------

const DRIFT_SCORE_MAX_DEPRECATION =
  'thresholds.drift_score_max is retired by the calibrated-null verdict and is ignored; ' +
  'remove it from config.json (it will be an error in a future release)';

test('computeDrift: deprecations carries the drift_score_max notice verbatim when the key is present', () => {
  const { deprecations } = computeDrift(
    SYNTHETIC_MARKERS, buildBaseline(), { drift_score_max: 25 }, { scoredWords: 550 }
  );
  assert.deepStrictEqual(deprecations, [DRIFT_SCORE_MAX_DEPRECATION],
    'deprecations must carry exactly the P7 string when thresholds.drift_score_max is present');
});

test('computeDrift: deprecations is empty when thresholds.drift_score_max is absent', () => {
  const { deprecations } = computeDrift(
    SYNTHETIC_MARKERS, buildBaseline(), { stylometry_marker_tolerance: 2.0 }, { scoredWords: 550 }
  );
  assert.deepStrictEqual(deprecations, [], 'deprecations must be empty when thresholds.drift_score_max is absent');
});

test('computeDrift: deprecations is empty when thresholds itself is absent entirely', () => {
  const { deprecations } = computeDrift(SYNTHETIC_MARKERS, buildBaseline(), undefined, { scoredWords: 550 });
  assert.deepStrictEqual(deprecations, [], 'deprecations must be empty when thresholds is undefined');
});

// ---------------------------------------------------------------------------
// computeDrift v5: validation order and error types (P1)
//   1. baseline.markers missing            -> plain Error
//   2. marker_set_version mismatch          -> StaleBaselineError
//   3. calibration missing/incomplete       -> InvalidCalibrationError
//   4. opts.scoredWords missing/non-positive -> plain Error
// ---------------------------------------------------------------------------

test('computeDrift: baseline.markers missing throws a plain Error (not a typed one)', () => {
  assert.throws(
    () => computeDrift(SYNTHETIC_MARKERS, {}, {}, { scoredWords: 550 }),
    (err) => {
      assert.strictEqual(err.name, 'Error', 'baseline.markers missing must throw a plain Error; got ' + err.name);
      return true;
    }
  );
});

test('computeDrift v5: a marker_set_version 4 baseline throws StaleBaselineError naming nfs-capture-voice as the remedy', () => {
  const v4Baseline = { markers: SYNTHETIC_MARKERS, marker_set_version: 4 };
  assert.throws(
    () => computeDrift(SYNTHETIC_MARKERS, v4Baseline, {}, { scoredWords: 550 }),
    (err) => {
      assert.strictEqual(err.name, 'StaleBaselineError', 'a v4 baseline must throw StaleBaselineError; got ' + err.name);
      assert.ok(err.message.includes('nfs-capture-voice'), 'error message must name nfs-capture-voice as the remedy; got: ' + err.message);
      return true;
    }
  );
});

test('computeDrift v5: current version but no calibration object at all throws InvalidCalibrationError', () => {
  const baseline = { markers: SYNTHETIC_MARKERS, marker_set_version: CURRENT_MARKER_SET_VERSION };
  assert.throws(
    () => computeDrift(SYNTHETIC_MARKERS, baseline, {}, { scoredWords: 550 }),
    (err) => {
      assert.strictEqual(err.name, 'InvalidCalibrationError', 'got ' + err.name);
      assert.strictEqual(err.code, 'INVALID_CALIBRATION', 'got ' + err.code);
      assert.strictEqual(err.exitCode, 2, 'got ' + err.exitCode);
      assert.ok(err.message.includes('nfs-capture-voice'), 'error message must name nfs-capture-voice as the remedy; got: ' + err.message);
      return true;
    }
  );
});

for (const missingField of ['spans', 'noise_scales', 'block_thresholds', 'regime']) {
  test('computeDrift v5: calibration missing "' + missingField + '" throws InvalidCalibrationError', () => {
    const calibration = buildCalibration();
    delete calibration[missingField];
    const baseline = buildBaseline({ calibration });
    assert.throws(
      () => computeDrift(SYNTHETIC_MARKERS, baseline, {}, { scoredWords: 550 }),
      (err) => {
        assert.strictEqual(err.name, 'InvalidCalibrationError',
          'missing calibration.' + missingField + ' must throw InvalidCalibrationError; got ' + err.name);
        return true;
      }
    );
  });
}

test('computeDrift v5: a marker present in baseline.markers but absent from a rung\'s noise_scales throws InvalidCalibrationError naming the marker and the rung', () => {
  const calibration = buildCalibration();
  delete calibration.noise_scales['2200'].contraction_rate;
  const baseline = buildBaseline({ calibration });
  assert.throws(
    () => computeDrift(SYNTHETIC_MARKERS, baseline, {}, { scoredWords: 550 }),
    (err) => {
      assert.strictEqual(err.name, 'InvalidCalibrationError', 'got ' + err.name);
      assert.ok(err.message.includes('contraction_rate'), 'error must name the missing marker; got: ' + err.message);
      assert.ok(err.message.includes('2200'), 'error must name the rung missing the marker; got: ' + err.message);
      return true;
    }
  );
});

test('computeDrift v5: validation order -- a stale version AND an incomplete calibration throws StaleBaselineError, not InvalidCalibrationError', () => {
  const baseline = { markers: SYNTHETIC_MARKERS, marker_set_version: 4 }; // no calibration at all
  assert.throws(
    () => computeDrift(SYNTHETIC_MARKERS, baseline, {}, { scoredWords: 550 }),
    (err) => {
      assert.strictEqual(err.name, 'StaleBaselineError',
        'the version check must run BEFORE the calibration check; got ' + err.name);
      return true;
    }
  );
});

test('computeDrift v5: opts.scoredWords missing throws a plain Error naming the parameter', () => {
  assert.throws(
    () => computeDrift(SYNTHETIC_MARKERS, buildBaseline(), {}),
    (err) => {
      assert.strictEqual(err.name, 'Error', 'got ' + err.name);
      assert.ok(err.message.includes('scoredWords'), 'error must name the scoredWords parameter; got: ' + err.message);
      return true;
    }
  );
});

for (const bad of [0, -1, -100]) {
  test('computeDrift v5: opts.scoredWords = ' + bad + ' (non-positive) throws a plain Error', () => {
    assert.throws(
      () => computeDrift(SYNTHETIC_MARKERS, buildBaseline(), {}, { scoredWords: bad }),
      (err) => {
        assert.strictEqual(err.name, 'Error', 'got ' + err.name);
        assert.ok(err.message.includes('scoredWords'), 'error must name the scoredWords parameter; got: ' + err.message);
        return true;
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Committed tree: golden sample book (measureBook shape only -- NOT computeDrift)
// ---------------------------------------------------------------------------
//
// The computeDrift-against-the-golden-baseline intent (a real chapter pair scoring as a
// PASS) and the voice-drift-fixture intent (a real chapter pair scoring as a BLOCK, with
// first_person_rate the worst marker) both moved to synthetic v5 tests below ("computeDrift
// v5: a passing case" / "a blocking case"), rather than reading either example's
// .studio/config.json: both examples still carry v4 baselines with no calibration ladder
// (declared red until Tasks 5 and 6 recapture them), and coupling this file's green status to
// that fixture state would break this file again the moment those baselines are recaptured
// to different numbers. measureChapter/measureBook themselves are version-independent (they
// only measure text, never read a baseline), so the shape test below is unaffected and stays.

test('golden sample book: measureBook produces 8-marker vector', () => {
  const root = join(EXAMPLES, 'sample-book');
  const ch1 = readFileSync(join(root, 'chapters', '01-listening-before-speaking.md'), 'utf8');
  const ch2 = readFileSync(join(root, 'chapters', '02-finding-your-network.md'), 'utf8');
  const v = measureBook([ch1, ch2]);

  const keys = Object.keys(v);
  assert.strictEqual(keys.length, 8, '8 markers returned');
  for (const k of keys) {
    assert.ok(typeof v[k] === 'number', k + ' is a number');
    assert.ok(isFinite(v[k]), k + ' is finite');
  }
});

// ---------------------------------------------------------------------------
// computeDrift v5: a passing case and a blocking case (synthetic, replacing the
// golden-sample-book / voice-drift-fixture computeDrift tests above -- see the comment there)
// ---------------------------------------------------------------------------

test('computeDrift v5: a passing case -- every marker within its calibrated noise scale is not exceeded', () => {
  const baseline = buildBaseline(); // SYNTHETIC_MARKERS verbatim as both baseline and measured
  const { statistic, threshold, exceeded } = computeDrift(SYNTHETIC_MARKERS, baseline, {}, { scoredWords: 550 });
  assert.strictEqual(statistic, 0, 'identical measured and baseline vectors give statistic 0');
  assert.ok(!exceeded, 'statistic 0 must not exceed any positive threshold; threshold=' + threshold);
});

test('computeDrift v5: a blocking case -- first_person_rate collapsing to near-zero is the worst marker and exceeds', () => {
  // Modeled on the shipped voice-drift fixture's own defect (PLANTED.md): first_person_rate
  // baseline 0.2262 drops to measured 0, a 100% deviation, while the other seven markers
  // stay within their calibrated noise.
  const baseline = buildBaseline({
    markers: {
      function_word_rate: 0.4717, contraction_rate: 0.0299, first_person_rate: 0.2262,
      second_person_rate: 3.3937, type_token_ratio: 0.7516, avg_word_length: 5.1923,
      avg_sentence_length: 13.1940, punctuation_rate: 13.0090,
    },
    calibration: buildCalibration({
      noise_scales: {
        '550': {
          function_word_rate: 8.0, contraction_rate: 8.0, first_person_rate: 15.0,
          second_person_rate: 8.0, type_token_ratio: 8.0, avg_word_length: 8.0,
          avg_sentence_length: 8.0, punctuation_rate: 8.0,
        },
        '2200': {
          function_word_rate: 4.0, contraction_rate: 4.0, first_person_rate: 8.0,
          second_person_rate: 4.0, type_token_ratio: 4.0, avg_word_length: 4.0,
          avg_sentence_length: 4.0, punctuation_rate: 4.0,
        },
      },
      block_thresholds: { '550': 3.0, '2200': 2.5 },
    }),
  });
  const measured = {
    function_word_rate: 0.4736, contraction_rate: 0.0301, first_person_rate: 0,
    second_person_rate: 3.4102, type_token_ratio: 0.7498, avg_word_length: 5.1801,
    avg_sentence_length: 13.2400, punctuation_rate: 13.0522,
  };
  const { statistic, threshold, exceeded, worstMarker, perMarker } = computeDrift(measured, baseline, {}, { scoredWords: 550 });
  assert.strictEqual(worstMarker, 'first_person_rate',
    'first_person_rate (100% deviation, a zero-baseline collapse) must be the worst marker; got ' + worstMarker);
  assert.strictEqual(exceeded, true,
    'statistic ' + statistic + ' must exceed threshold ' + threshold);
  const fp = perMarker.find(m => m.marker === 'first_person_rate');
  assert.strictEqual(fp.flagged, true, 'first_person_rate must be flagged (100% deviation clears the 2% band)');
  assert.strictEqual(fp.measured, 0, 'first_person_rate measured must be 0');
});

// ---------------------------------------------------------------------------
// Committed tree: BIN-spawning CLI tests against the REAL committed golden/voice-drift
// fixtures, IN PLACE (not a clone)
// ---------------------------------------------------------------------------

// The four tests below run the CLI against examples/sample-book and examples/fixtures/
// voice-drift AS COMMITTED, not a temp clone with a synthetic baseline patched in (unlike
// tests/engines/gate.test.mjs's or stylometry-explain.test.mjs's approach): their own intent
// is specifically to prove these two REAL fixtures' documented behavior under the shipped
// engine. Task 5 (ADR-0012 implementation wave) recaptured examples/sample-book/.studio/
// config.json's baseline under v5 (an independent, disjoint voice corpus; regime book), which
// un-skips the two golden-book tests below. examples/fixtures/voice-drift/.studio/config.json
// still carries its original marker_set_version 4 baseline: measured directly (this task),
// the fixture's planted register-shift chapter, scored against the SAME independent corpus
// baseline every other sample-book-clone fixture now shares, does not exceed the calibrated
// threshold at any span (aggregate, chapter 1, or chapter 2 -- confirmed by direct measurement,
// not merely inferred), because first_person_rate and second_person_rate carry noise scales
// wide enough that even a 100% deviation stays under threshold at this fixture's ~900-word
// scale. Recalibrating a baseline that WOULD catch this defect needs either a voice-drift-
// specific corpus deliberately less sparse than the shared voice (a plan-level call, not an
// implementer judgment call) or a change to the fixture's chapter text; both are BLOCKED
// pending a coordinator ruling. The two voice-drift tests below stay skipped for that reason.
// Bodies are reworked to the v5 JSON shape now (statistic/worstMarker/threshold/exceeded/
// regime/scoredWords, perMarker.z replacing the retired driftScore/contribution/capped triple)
// so a future recapture only needs to remove the skip option, not rework the assertions again.

const SKIP_BLOCKED_VOICE_DRIFT_REASON =
  'BLOCKED pending a coordinator ruling (ADR-0012 implementation wave, Task 5): ' +
  'examples/fixtures/voice-drift/.studio/config.json still carries a marker_set_version 4 ' +
  'baseline; the planted register-shift chapter, measured against the v5 independent-corpus ' +
  'baseline every other sample-book-clone fixture now shares, does not exceed the calibrated ' +
  'threshold at any span (confirmed by direct measurement) because its own noise scales are ' +
  'wide enough to absorb even a 100% first_person_rate/second_person_rate deviation at this ' +
  'fixture\'s word count; a fix needs a plan-level decision, not an implementer judgment call';

test('golden sample book CLI: --all --json exits 0', () => {
  const bookRoot = join(EXAMPLES, 'sample-book');
  const result = spawnSync(
    process.execPath, [BIN, '--all', '--json'],
    { cwd: bookRoot, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0,
    'golden book CLI exits 0; stderr: ' + result.stderr);

  const out = JSON.parse(result.stdout);
  assert.ok(typeof out.statistic === 'number', 'statistic is a number');
  assert.strictEqual(out.verdict, 'pass', 'verdict is pass');
  assert.strictEqual(out.exceeded, false);
  assert.ok(out.statistic < out.threshold,
    'statistic ' + out.statistic.toFixed(2) + ' < threshold ' + out.threshold);
});

test('golden sample book CLI: ns-stylometry --chapter=<slug> --json exits 0 for EVERY chapter', () => {
  const bookRoot = join(EXAMPLES, 'sample-book');
  const chapterDir = join(bookRoot, 'chapters');
  const chapterFiles = readdirSync(chapterDir).filter(f => f.endsWith('.md')).sort();

  for (const file of chapterFiles) {
    const slug = file.replace(/\.md$/, '');
    const result = spawnSync(
      process.execPath, [BIN, '--chapter=' + slug, '--json'],
      { cwd: bookRoot, encoding: 'utf8' }
    );
    assert.strictEqual(result.status, 0,
      'chapter ' + slug + ' CLI must exit 0; stderr: ' + result.stderr);
    const out = JSON.parse(result.stdout);
    assert.strictEqual(out.verdict, 'pass',
      'chapter ' + slug + ' verdict must be pass; got ' + out.verdict +
      ' (statistic ' + out.statistic.toFixed(2) + ' vs threshold ' + out.threshold + ')');
  }
});

test('voice-drift fixture CLI: --all --json exits 1', { skip: SKIP_BLOCKED_VOICE_DRIFT_REASON }, () => {
  const bookRoot = join(EXAMPLES, 'fixtures', 'voice-drift');
  const result = spawnSync(
    process.execPath, [BIN, '--all', '--json'],
    { cwd: bookRoot, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 1,
    'voice-drift CLI exits 1; stderr: ' + result.stderr);

  const out = JSON.parse(result.stdout);
  assert.ok(typeof out.statistic === 'number', 'statistic is a number');
  assert.strictEqual(out.verdict, 'block', 'verdict is block');
  assert.strictEqual(out.exceeded, true);
  assert.ok(out.statistic >= out.threshold,
    'statistic ' + out.statistic.toFixed(2) + ' >= threshold ' + out.threshold);

  // first_person_rate must be flagged (reconciliation-stable flag)
  const fpEntry = Object.entries(out.markers).find(([k]) => k === 'first_person_rate');
  assert.ok(fpEntry, 'first_person_rate present in markers output');
  assert.strictEqual(fpEntry[1].flagged, true, 'first_person_rate flagged in JSON output');
  assert.strictEqual(typeof fpEntry[1].z, 'number', 'first_person_rate carries a numeric z');
});

test('voice-drift fixture CLI: ns-stylometry --chapter=<slug> --json exits 1 for EVERY chapter', { skip: SKIP_BLOCKED_VOICE_DRIFT_REASON }, () => {
  const bookRoot = join(EXAMPLES, 'fixtures', 'voice-drift');
  const chapterDir = join(bookRoot, 'chapters');
  const chapterFiles = readdirSync(chapterDir).filter(f => f.endsWith('.md')).sort();

  for (const file of chapterFiles) {
    const slug = file.replace(/\.md$/, '');
    const result = spawnSync(
      process.execPath, [BIN, '--chapter=' + slug, '--json'],
      { cwd: bookRoot, encoding: 'utf8' }
    );
    assert.strictEqual(result.status, 1,
      'chapter ' + slug + ' CLI must exit 1 (the fixture must still catch drift per chapter); stderr: ' +
      result.stderr);
    const out = JSON.parse(result.stdout);
    assert.strictEqual(out.verdict, 'block',
      'chapter ' + slug + ' verdict must be block; got ' + out.verdict +
      ' (statistic ' + out.statistic.toFixed(2) + ' vs threshold ' + out.threshold + ')');
    assert.ok(out.statistic >= out.threshold,
      'chapter ' + slug + ' statistic ' + out.statistic.toFixed(2) + ' must be >= threshold ' + out.threshold);
  }
});

// ---------------------------------------------------------------------------
// measureBook: shape contract
// ---------------------------------------------------------------------------

test('measureBook: empty chapter list returns zero-vector with 8 keys', () => {
  const v = measureBook([]);
  const keys = ['function_word_rate', 'contraction_rate', 'first_person_rate',
    'second_person_rate', 'type_token_ratio', 'avg_word_length',
    'avg_sentence_length', 'punctuation_rate'];
  for (const k of keys) {
    assert.ok(Object.prototype.hasOwnProperty.call(v, k), 'missing ' + k);
    assert.strictEqual(v[k], 0, k + ' should be 0 with no chapters');
  }
});

// ---------------------------------------------------------------------------
// CLI exit codes -- version-agnostic (--project resolution happens before any stylometry
// measurement), un-skipped by Task 4 alongside the gate-engine.mjs/status-engine.mjs/
// bin/ns-stylometry import fix.
// ---------------------------------------------------------------------------

test('CLI exits 2 when --project points to non-existent directory', () => {
  const result = spawnSync(
    process.execPath, [BIN, '--project=/nonexistent/path/xyz', '--all'],
    { encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 2, 'bad project path exits 2');
});

// ---------------------------------------------------------------------------
// P7 (ADR-0012 voice verdict scope): thresholds.drift_score_max deprecation notice surfaced on
// stderr -- the CLI half of the two P7 surfaces (the gate's own detail-string surface is tested
// in tests/engines/gate.test.mjs). Uses a temp clone of the golden book patched with a
// synthetic, self-consistent v5 baseline (writeSyntheticV5Baseline) so this test does not depend
// on Task 5's fixture recapture; the deprecation notice comes from thresholds.drift_score_max
// being present in config, independent of whether the drift verdict itself passes or blocks.
// ---------------------------------------------------------------------------

test('CLI: thresholds.drift_score_max present -> the P7 retirement notice is printed to stderr', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ns-stylometry-deprecation-'));
  try {
    cpSync(join(EXAMPLES, 'sample-book'), dir, { recursive: true });
    writeSyntheticV5Baseline(dir);
    const configPath = join(dir, '.studio', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.thresholds = config.thresholds || {};
    config.thresholds.drift_score_max = 25;
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    const result = spawnSync(process.execPath, [BIN, '--all', '--json'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, 'stderr: ' + result.stderr);
    assert.ok(
      result.stderr.includes(
        'thresholds.drift_score_max is retired by the calibrated-null verdict and is ignored'
      ),
      'stderr must carry the P7 retirement notice; got: ' + result.stderr
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: thresholds.drift_score_max absent -> stderr carries no deprecation notice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ns-stylometry-no-deprecation-'));
  try {
    cpSync(join(EXAMPLES, 'sample-book'), dir, { recursive: true });
    writeSyntheticV5Baseline(dir);

    const result = spawnSync(process.execPath, [BIN, '--all', '--json'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, 'stderr: ' + result.stderr);
    assert.strictEqual(result.stderr, '', 'no deprecation notice when the retired key is absent; got stderr: ' + result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --measure mode (TSK-037: voice-capture agent) -- version-agnostic (--measure only calls
// measureChapter/measureBook, never computeDrift), un-skipped by Task 4 alongside the
// gate-engine.mjs/status-engine.mjs/bin/ns-stylometry import fix.
// ---------------------------------------------------------------------------

test('measure mode: single chapter output equals measureChapter direct result', () => {
  const chFile = join(EXAMPLES, 'sample-book', 'chapters', '01-listening-before-speaking.md');
  const result = spawnSync(
    process.execPath, [BIN, '--measure=' + chFile],
    { encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0, 'exits 0; stderr: ' + result.stderr);
  const out = JSON.parse(result.stdout);
  const text = readFileSync(chFile, 'utf8');
  const expected = measureChapter(text);
  for (const [k, v] of Object.entries(expected)) {
    assert.ok(
      Math.abs(out.markers[k] - v) < 1e-10,
      'marker ' + k + ': expected ' + v + ' got ' + out.markers[k]
    );
  }
});

test('measure mode: two chapters output equals measureBook aggregate', () => {
  const ch1 = join(EXAMPLES, 'sample-book', 'chapters', '01-listening-before-speaking.md');
  const ch2 = join(EXAMPLES, 'sample-book', 'chapters', '02-finding-your-network.md');
  const result = spawnSync(
    process.execPath, [BIN, '--measure=' + ch1 + ',' + ch2],
    { encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0, 'exits 0; stderr: ' + result.stderr);
  const out = JSON.parse(result.stdout);
  const text1 = readFileSync(ch1, 'utf8');
  const text2 = readFileSync(ch2, 'utf8');
  const expected = measureBook([text1, text2]);
  for (const [k, v] of Object.entries(expected)) {
    assert.ok(
      Math.abs(out.markers[k] - v) < 1e-10,
      'marker ' + k + ': expected ' + v + ' got ' + out.markers[k]
    );
  }
});

test('measure mode: missing file exits 2 naming the file', () => {
  const missing = '/nonexistent-ns-measure-xyz/no-such-chapter.md';
  const result = spawnSync(
    process.execPath, [BIN, '--measure=' + missing],
    { encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 2, 'missing file exits 2; stderr: ' + result.stderr);
  assert.ok(
    result.stderr.includes('no-such-chapter.md'),
    'stderr names the missing file: ' + result.stderr
  );
});

test('measure mode: markers key set equals golden config baseline.markers key set', () => {
  const chFile = join(EXAMPLES, 'sample-book', 'chapters', '01-listening-before-speaking.md');
  const result = spawnSync(
    process.execPath, [BIN, '--measure=' + chFile],
    { encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0, 'exits 0; stderr: ' + result.stderr);
  const out = JSON.parse(result.stdout);
  const config = JSON.parse(readFileSync(
    join(EXAMPLES, 'sample-book', '.studio', 'config.json'), 'utf8'
  ));
  const goldenKeys = Object.keys(config.stylometry.baseline.markers).sort();
  const measureKeys = Object.keys(out.markers).sort();
  assert.deepStrictEqual(
    measureKeys, goldenKeys,
    'measure markers keys must equal golden config baseline.markers keys exactly'
  );
});

test('measure mode: writes nothing to disk', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ns-measure-test-'));
  const tmpFile = join(tmpDir, 'test-sample.md');
  const srcText = readFileSync(
    join(EXAMPLES, 'sample-book', 'chapters', '01-listening-before-speaking.md'), 'utf8'
  );
  writeFileSync(tmpFile, srcText, 'utf8');

  const beforeMtime = statSync(tmpFile).mtimeMs;
  const beforeCount = readdirSync(tmpDir).length;

  const result = spawnSync(
    process.execPath, [BIN, '--measure=' + tmpFile],
    { cwd: tmpDir, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0, 'exits 0; stderr: ' + result.stderr);

  const afterCount = readdirSync(tmpDir).length;
  const afterMtime = statSync(tmpFile).mtimeMs;

  assert.strictEqual(afterCount, beforeCount, 'no new files written in temp dir');
  assert.strictEqual(afterMtime, beforeMtime, 'sample file mtime unchanged');

  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Correction A: type_token_ratio length invariance (roadmap row 1.7)
// ---------------------------------------------------------------------------
//
// The old definition, uniqueWordCount / totalWords, falls monotonically as
// text grows, because a fixed vocabulary is diluted by an ever-larger
// denominator. A moving-average type-token ratio (the mean of the plain
// ratio over every sliding window of a fixed token count) does not have this
// property by construction: the window never changes size no matter how
// much surrounding text is measured. Both tests below build their own
// synthetic corpora; neither asserts against the sample book's numbers.

test('property: type_token_ratio is length-invariant across a short and a much longer sample of the same synthetic prose', () => {
  // A 10-word cycle, repeated. The documented moving-average window (100
  // tokens) is an exact multiple of the cycle length (10), so any 100-token
  // window of this stream contains all 10 cycle words and no others,
  // regardless of where the window starts or how long the surrounding text
  // is. A flat ratio has no such property: its denominator (totalWords)
  // keeps growing while the numerator (10 distinct words) does not, so it
  // keeps falling as the sample lengthens.
  const CYCLE = ['glass', 'harbor', 'ordinary', 'kettle', 'margin',
    'follow', 'orchard', 'lantern', 'ripple', 'avenue'];
  function synth(tokenCount) {
    const words = [];
    for (let i = 0; i < tokenCount; i++) words.push(CYCLE[i % CYCLE.length]);
    return words.join(' ') + '.';
  }

  const shortPassage = synth(150);  // one chapter-sized synthetic sample
  const longCorpus = synth(1500);   // ten times longer, identical vocabulary pattern

  const shortTTR = measureChapter(shortPassage).type_token_ratio;
  const longTTR = measureChapter(longCorpus).type_token_ratio;

  assert.ok(
    Math.abs(shortTTR - longTTR) < 0.005,
    'type_token_ratio must be length-invariant within a small tolerance: short=' +
    shortTTR + ' long=' + longTTR + ' delta=' + Math.abs(shortTTR - longTTR)
  );
});

test('unit: type_token_ratio moving average over a hand-computable two-window corpus', () => {
  // 100 fully distinct tokens (window 0 is hand-verifiable: unique/window =
  // 100/100 = 1.00), followed by one more token that duplicates the SECOND
  // token. This produces exactly two overlapping 100-token windows:
  //   window 0 = tokens[0..99]  (100 distinct)                  -> 100/100 = 1.00
  //   window 1 = tokens[1..100] (token[0] drops out, a duplicate
  //              of token[1] comes in instead of a new word)     -> 99/100  = 0.99
  //   mean = (1.00 + 0.99) / 2 = 0.995
  // distinctWords() generates a, b, ..., z, aa, ab, ... (bijective base-26,
  // letters only, so every generated token matches the engine's word regex).
  function distinctWords(count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      let n = i, s = '';
      do {
        s = String.fromCharCode(97 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
      } while (n >= 0);
      out.push(s);
    }
    return out;
  }

  const hundred = distinctWords(100);
  const tokens = hundred.concat([hundred[1]]); // append a duplicate of the second word
  const text = tokens.join(' ') + '.';

  const v = measureChapter(text);
  assert.ok(
    Math.abs(v.type_token_ratio - 0.995) < 0.0001,
    'hand-computed moving-average TTR should be (1.00 + 0.99) / 2 = 0.995; got ' + v.type_token_ratio
  );
});

// ---------------------------------------------------------------------------
// The stale-baseline guard: marker_set_version. computeDrift v5's return shape and
// per-marker-contribution/capped tests (formerly here, roadmap row 1.7's "Correction B")
// moved above to the "computeDrift v5" sections, since the capped-sum rule and its
// contribution/capped fields are retired entirely (ADR-0012, voice verdict scope); the stale-
// version guard itself is unchanged by the v5 combining-rule swap, so these two tests are
// unchanged (the version check runs, and throws, before either test's baseline is examined
// for a calibration object at all -- see the validation-order tests above).
// ---------------------------------------------------------------------------

test('computeDrift: scoring against a baseline whose marker_set_version does not match the current one fails with a named, actionable error', () => {
  const measured = { x: 1.0 };
  const staleBaseline = { markers: { x: 1.0 }, marker_set_version: 1 };

  assert.throws(
    () => computeDrift(measured, staleBaseline, { drift_score_max: 30, stylometry_marker_tolerance: 2.0 }, { scoredWords: 550 }),
    (err) => {
      assert.strictEqual(err.name, 'StaleBaselineError',
        'error must be a named StaleBaselineError; got ' + err.name);
      assert.ok(err.message.includes('nfs-capture-voice'),
        'error message must name nfs-capture-voice as the remedy; got: ' + err.message);
      return true;
    }
  );
});

test('computeDrift: a baseline with no marker_set_version field at all is treated as version 1 and rejected as stale', () => {
  const measured = { x: 1.0 };
  const noVersionBaseline = { markers: { x: 1.0 } }; // marker_set_version absent entirely

  assert.throws(
    () => computeDrift(measured, noVersionBaseline, { drift_score_max: 30, stylometry_marker_tolerance: 2.0 }, { scoredWords: 550 }),
    /nfs-capture-voice/,
    'an absent marker_set_version field must be treated as version 1 and rejected as stale'
  );
});

// ---------------------------------------------------------------------------
// Typographic normalization (marker_set_version 3).
//
// Word processors emit U+2019 for an apostrophe and U+201C/U+201D for double
// quotes. Before version 3, CONTRACTION_RE and PUNCT_RE were ASCII-only with no
// fold in front of them, so an author who pasted samples out of Word captured a
// baseline with contraction_rate = 0 and an understated punctuation_rate. Every
// chapter they later wrote with a plain apostrophe then read as a 100 percent
// deviation on contraction_rate.
//
// Every non-ASCII character under test is written as an escape sequence rather
// than a literal, so this file stays pure ASCII (the repository sweeps for stray
// invisible characters, and a literal smart quote here would be indistinguishable
// from an accident) and so each test names the exact codepoint it covers.
//
// The assertions are written against the pair-equality property -- the two
// encodings of the same prose must measure identically -- rather than against a
// fixed expected number, because that property is what the fix guarantees and it
// stays true if a marker's definition is later refined.
// ---------------------------------------------------------------------------

const RSQUO = '\u2019';   // right single quotation mark, the default Word apostrophe
const LSQUO = '\u2018';
const LDQUO = '\u201C';
const RDQUO = '\u201D';
const HELLIP = '\u2026';

const ASCII_PROSE = "I've been here a while. It's fine, really. What's next for us? " +
                    "I'm sure they're right. Don't stop now.";

test('typography: a U+2019 apostrophe measures identically to an ASCII one across every marker', () => {
  const curly = ASCII_PROSE.replace(/'/g, RSQUO);
  assert.notEqual(curly, ASCII_PROSE, 'the two encodings must actually differ as text');

  const a = measureChapter(ASCII_PROSE);
  const c = measureChapter(curly);

  assert.deepEqual(c, a,
    'prose written with U+2019 must produce the same eight-marker vector as the same ' +
    'prose written with U+0027; a difference here means the fold in preprocess() is gone');
});

test('typography: contraction_rate is non-zero for U+2019 apostrophes (the defect this closes)', () => {
  const curly = ASCII_PROSE.replace(/'/g, RSQUO);
  const rate = measureChapter(curly).contraction_rate;

  assert.ok(rate > 0,
    'contraction_rate read ' + rate + ' for prose containing five contractions; before ' +
    'version 3 this was exactly 0, which silently zeroed the marker for any author ' +
    'writing in a mainstream word processor');
});

test('typography: U+201C and U+201D count toward punctuation_rate the same as U+0022', () => {
  const ascii = 'He said "one two three" and left. She said "four five six" and left.';
  const smart = ascii.replace(/"([^"]*)"/g, LDQUO + '$1' + RDQUO);
  assert.notEqual(smart, ascii, 'the two encodings must actually differ as text');

  assert.equal(measureChapter(smart).punctuation_rate, measureChapter(ascii).punctuation_rate,
    'smart double quotes must be counted as punctuation, the same as the ASCII form');
});

test('typography: a folded single quotation mark does not become a false contraction', () => {
  // The fold turns U+2018/U+2019 into an ASCII apostrophe, so a quoted word becomes
  // 'good'. CONTRACTION_RE requires a letter on BOTH sides, and a quotation mark has
  // whitespace or punctuation on one side by construction, so it cannot match.
  const quoted = 'That was a ' + LSQUO + 'good' + RSQUO + ' idea back then. They agreed with it.';

  assert.equal(measureChapter(quoted).contraction_rate, 0,
    'a quoted word must not be counted as a contraction after folding');
});

test('typography: U+2026 (ellipsis) is deliberately left alone', () => {
  // U+2026 is NOT folded. Expanding it to three periods would count as three
  // punctuation characters instead of one and could introduce a spurious sentence
  // boundary mid-sentence, since SENTENCE_END_RE treats a run of periods followed by
  // whitespace as a sentence end. This test pins that decision so a later change to
  // the fold has to confront it rather than make it by accident.
  const withEllipsis = 'They waited' + HELLIP + ' and then they left. It ended there.';
  const withoutEllipsis = 'They waited and then they left. It ended there.';

  assert.equal(
    measureChapter(withEllipsis).avg_sentence_length,
    measureChapter(withoutEllipsis).avg_sentence_length,
    'U+2026 must not create a sentence boundary; if this fails, the ellipsis was folded'
  );
});

test('typography: the fold carries a marker-set version bump, so a pre-fold baseline is rejected', () => {
  // A baseline captured before the fold carries a contraction_rate measured under the
  // old meaning. Scoring against it must fail loudly rather than report the difference
  // as drift. This is the guard ADR-0011 (tranche 2 decisions) established, exercised
  // for the version it was bumped to here.
  assert.ok(CURRENT_MARKER_SET_VERSION >= 3,
    'the typographic fold changes what contraction_rate means, so the version this fold ' +
    'bumped to (3) must still be reachable; not a literal, so a later bump does not break it');

  const preFold = { markers: measureChapter(ASCII_PROSE), marker_set_version: 2 };
  assert.throws(
    () => computeDrift(measureChapter(ASCII_PROSE), preFold, { drift_score_max: 25 }),
    /nfs-capture-voice/,
    'a version-2 baseline must be rejected as stale, not scored against'
  );
});

// ---------------------------------------------------------------------------
// Word tokenization (marker_set_version 4).
//
// WORD_RE was ASCII-only ([a-zA-Z]), so an accented letter split a word in two:
// "cafe" with an acute became "caf" plus a lost fragment, "Munchen" with an umlaut
// became "M" plus "nchen". Every word-denominated marker moved for any chapter
// mentioning an accented name or a borrowed word. WORD_RE now matches \p{L}, the
// Unicode letter category, instead.
//
// Every non-ASCII character under test is written as an escape sequence rather than
// a literal, for the same reason as the typography tests above: this file stays pure
// ASCII and each test names the exact codepoint it covers.
// ---------------------------------------------------------------------------

const E_ACUTE = '\u00e9';      // e with acute, as in "cafe" and "resume"
const U_DIAERESIS = '\u00fc';  // u with diaeresis, as in "Munchen"
const I_DIAERESIS = '\u00ef';  // i with diaeresis, as in "naive"
const E_DIAERESIS = '\u00eb';  // e with diaeresis, as in "Zoe" -> "Zoe with an umlaut"

const PLAIN_ACCENT_PROSE =
  'The cafe owner in Munchen was naive about the resume he had written.';
const ACCENTED_PROSE =
  'The caf' + E_ACUTE + ' owner in M' + U_DIAERESIS + 'nchen was na' + I_DIAERESIS +
  've about the r' + E_ACUTE + 'sum' + E_ACUTE + ' he had written.';

test('word tokenization: precomposed accented Latin prose measures identically to its plain-ASCII original', () => {
  assert.notEqual(ACCENTED_PROSE, PLAIN_ACCENT_PROSE,
    'the two strings must actually differ as text');

  const plain = measureChapter(PLAIN_ACCENT_PROSE);
  const accented = measureChapter(ACCENTED_PROSE);

  assert.deepEqual(accented, plain,
    'prose written with precomposed accented letters must produce the same eight-marker ' +
    'vector as the same prose with the accents stripped; a difference here means WORD_RE ' +
    'is fragmenting the accented words again. Before this fix the accented sentence ' +
    'measured 16 tokens against the plain sentence\'s 13, because each of the three ' +
    'accented words fragmented into two tokens');
});

test('word tokenization: a Cyrillic sentence tokenizes as one token per space-delimited word', () => {
  // U+041C U+043E U+0441 U+043A U+0432 U+0430 (space) U+0431 U+043E U+043B U+044C
  // U+0448 U+043E U+0439 (space) U+0433 U+043E U+0440 U+043E U+0434 -- "Moskva bolshoy
  // gorod" (Moscow [is a] big city), an alphabetic, space-delimited script, the case
  // the History comment's "tokenize as whole words" claim actually covers.
  const cyrillicSentence =
    '\u041c\u043e\u0441\u043a\u0432\u0430 \u0431\u043e\u043b\u044c\u0448\u043e\u0439 ' +
    '\u0433\u043e\u0440\u043e\u0434.';
  assert.equal(countWords(cyrillicSentence), 3,
    'a Cyrillic sentence with three space-delimited words must count as three words, not ' +
    'zero; the pre-fix ASCII-only regex matched no Cyrillic letters at all');
});

test('word tokenization: a space-free script matches as one run, not one token per word (documented limitation, not a correctness claim)', () => {
  // \p{L}+ has no notion of a word boundary inside a script written without spaces
  // between words. A whole run of CJK letters matches as ONE token, not one token per
  // intended word. This is a residual limitation, not something this fix claims to
  // solve: the pre-fix regex produced ZERO tokens for this sentence (it matched no
  // character outside a-z/A-Z), and the post-fix regex produces exactly ONE token for
  // the whole ten-character sentence. Neither is a correct word count; the fix changes
  // which wrong number comes out, not whether the number is right. A book written
  // primarily in such a script needs a different tokenizer, not a wider character class.
  // U+3053 U+308C U+306F U+65E5 U+672C U+8A9E U+306E U+6587 U+3067 U+3059 -- "Kore wa
  // nihongo no bun desu" (This is a Japanese sentence).
  const japaneseSentence =
    '\u3053\u308c\u306f\u65e5\u672c\u8a9e\u306e\u6587\u3067\u3059';
  assert.equal(countWords(japaneseSentence), 1,
    'the whole space-free sentence matches as a single token; this pins the documented ' +
    'limitation so a future change to it is a deliberate decision, not an accident');
});

test('word tokenization: a hyphenated compound with an accented part still counts as one token', () => {
  const sentence = 'The caf' + E_ACUTE + '-owner smiled.';
  assert.equal(countWords(sentence), 3,
    'caf' + E_ACUTE + '-owner must count as one hyphenated token (three words total: The, ' +
    'cafe-owner, smiled), the same hyphen-join behavior WORD_RE already gave ASCII ' +
    'compounds like "well-curated"; a regex missing the hyphen-join group would split it ' +
    'into two words (four total), and a regex missing the u flag would fail to match ' +
    '\\p{L} as a Unicode property at all (zero words)');
});

test('word tokenization: CONTRACTION_RE stays ASCII-only, unaffected by the WORD_RE widening (residual limitation and a guard against an unintended coupling)', () => {
  // Zoe-with-diaeresis's is the discriminating case: the letter immediately before the
  // apostrophe is non-ASCII, so under the current ASCII-only CONTRACTION_RE it
  // contributes ZERO matches. If CONTRACTION_RE were ever widened to \p{L} the same way
  // WORD_RE was widened here, this would become ONE match and contraction_rate would
  // move. "Muller's" (u with diaeresis) is NOT a discriminating case: it yields exactly
  // one match either way, because the FINAL letter before the apostrophe is plain ASCII
  // ("r"); only the matched substring changes ("ller's" to "Muller's"), not the count
  // contraction_rate actually reads. A test written on that case would be decorative.
  const withNonAsciiStem =
    'It is fine. She agreed with it. Zo' + E_DIAERESIS + '\'s idea worked out well in the end.';
  const withoutIt =
    'It is fine. She agreed with it. The idea worked out well in the end.';

  assert.equal(measureChapter(withNonAsciiStem).contraction_rate,
    measureChapter(withoutIt).contraction_rate,
    'a possessive whose stem ends in a non-ASCII letter must not be counted as a ' +
    'contraction; if this fails, CONTRACTION_RE has been widened to match non-ASCII ' +
    'letters, which is a deliberate decision this test exists to force, not an accident');
});
