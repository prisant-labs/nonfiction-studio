// tests/engines/stylometry.test.mjs
// what-it-is:   unit tests for hooks/lib/stylometry-engine.mjs
// what-it-does: verifies measureChapter, measureBook, and computeDrift against:
//               (1) a hand-computable two-sentence synthetic text where every marker
//                   can be verified by arithmetic in these comments;
//               (2) the golden sample-book (exit 0, score well below threshold);
//               (3) the voice-drift fixture (exit 1, first_person_rate flagged);
//               (4) the zero-baseline rule;
//               (5) the missing-baseline exit-2 contract (via CLI invocation).
// runner:       node --test tests/engines/stylometry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  measureChapter, measureBook, computeDrift, countWords, CURRENT_MARKER_SET_VERSION,
} from '../../hooks/lib/stylometry-engine.mjs';

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
// computeDrift: zero-baseline rule
// ---------------------------------------------------------------------------

test('computeDrift: zero-baseline with zero measured gives 0 deviationPct', () => {
  const measured  = { marker_a: 0, marker_b: 1.0 };
  const baseline  = { markers: { marker_a: 0, marker_b: 1.0 }, marker_set_version: CURRENT_MARKER_SET_VERSION };
  const { perMarker } = computeDrift(measured, baseline, { drift_score_max: 10, stylometry_marker_tolerance: 2.0 });
  const ma = perMarker.find(m => m.marker === 'marker_a');
  assert.strictEqual(ma.deviationPct, 0, 'zero baseline / zero measured -> deviationPct 0');
  assert.strictEqual(ma.flagged, false, 'deviationPct 0 is not flagged');
});

test('computeDrift: zero-baseline with non-zero measured gives 100 deviationPct', () => {
  const measured = { marker_a: 5.0 };
  const baseline = { markers: { marker_a: 0 }, marker_set_version: CURRENT_MARKER_SET_VERSION };
  const { perMarker } = computeDrift(measured, baseline, { drift_score_max: 10, stylometry_marker_tolerance: 2.0 });
  const ma = perMarker.find(m => m.marker === 'marker_a');
  assert.strictEqual(ma.deviationPct, 100, 'zero baseline / non-zero measured -> deviationPct 100');
  assert.strictEqual(ma.flagged, true, 'deviationPct 100 is flagged (exceeds 2% band)');
});

test('computeDrift: exceeded is true when score >= drift_score_max', () => {
  // Four markers, each deviating far enough to be capped at driftScoreMax / 3; their
  // combined capped contribution comfortably clears the threshold. A single wildly
  // deviating marker cannot do this alone anymore (Correction B, roadmap row 1.7);
  // see the dedicated single-marker-bound property test for that guarantee.
  const baseline = {
    markers: { a: 1.0, b: 1.0, c: 1.0, d: 1.0 },
    marker_set_version: CURRENT_MARKER_SET_VERSION,
  };
  const measured = { a: 100.0, b: 100.0, c: 100.0, d: 100.0 };
  const { exceeded, score } = computeDrift(measured, baseline,
    { drift_score_max: 10, stylometry_marker_tolerance: 2.0 });
  assert.ok(score > 10, 'score should be large');
  assert.strictEqual(exceeded, true, 'exceeded is true when score >= threshold');
});

test('computeDrift: exceeded is false when score < drift_score_max', () => {
  const baseline = { markers: { x: 1.0 }, marker_set_version: CURRENT_MARKER_SET_VERSION };
  const measured = { x: 1.0 };
  const { exceeded, score } = computeDrift(measured, baseline,
    { drift_score_max: 10, stylometry_marker_tolerance: 2.0 });
  assert.strictEqual(score, 0, 'identical values give score 0');
  assert.strictEqual(exceeded, false, 'exceeded is false when score < threshold');
});

// ---------------------------------------------------------------------------
// Committed tree: golden sample book (exit 0)
// ---------------------------------------------------------------------------

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

test('golden sample book: computeDrift score is below threshold (exit 0)', () => {
  const root = join(EXAMPLES, 'sample-book');
  const ch1 = readFileSync(join(root, 'chapters', '01-listening-before-speaking.md'), 'utf8');
  const ch2 = readFileSync(join(root, 'chapters', '02-finding-your-network.md'), 'utf8');
  const config = JSON.parse(readFileSync(join(root, '.studio', 'config.json'), 'utf8'));

  const measured = measureBook([ch1, ch2]);
  const baseline = config.stylometry.baseline;
  const thresholds = config.thresholds;

  const { score, exceeded } = computeDrift(measured, baseline, thresholds);
  assert.ok(!exceeded, 'golden book drift does not exceed threshold; score=' + score);
  // The golden book score should be very low (engine baseline was set to engine values)
  assert.ok(score < thresholds.drift_score_max,
    'golden score ' + score.toFixed(2) + ' must be < threshold ' + thresholds.drift_score_max);
});

// ---------------------------------------------------------------------------
// Committed tree: golden sample book via CLI (exit 0)
// ---------------------------------------------------------------------------

test('golden sample book CLI: --all --json exits 0', () => {
  const bookRoot = join(EXAMPLES, 'sample-book');
  const result = spawnSync(
    process.execPath, [BIN, '--all', '--json'],
    { cwd: bookRoot, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0,
    'golden book CLI exits 0; stderr: ' + result.stderr);

  const out = JSON.parse(result.stdout);
  assert.ok(typeof out.driftScore === 'number', 'driftScore is a number');
  assert.strictEqual(out.verdict, 'pass', 'verdict is pass');
  assert.ok(out.driftScore < out.threshold,
    'driftScore ' + out.driftScore.toFixed(2) + ' < threshold ' + out.threshold);
});

// ---------------------------------------------------------------------------
// Committed tree: golden sample book, EVERY CHAPTER INDIVIDUALLY (roadmap row 1.7)
// ---------------------------------------------------------------------------
//
// The two "golden sample book" tests above only prove the WHOLE BOOK passes as
// a combined sample. They do not prove any individual chapter passes on its
// own, and a per-chapter gate run measures exactly one chapter (measureChapter,
// a much smaller denominator) against the same book-level baseline -- a
// materially different computation from measureBook. A book can pass in
// aggregate while every one of its chapters individually blocks: prior to the
// chapters being made voice-consistent, both chapters measured well over 200
// against a threshold of 35 in isolation, driven substantially by a
// near-zero-baseline instability in deviationPct that is written up for
// roadmap row 1.7 (voice registers) and the D-08 (hybrid voice scoring)
// amendment.
//
// This guarantee currently holds only because both golden chapters still
// carry the padded closing paragraph the stylometry baseline was fit against
// (examples/sample-book/.studio/config.json's stylometry.baseline.method
// discloses the padding and that de-padding stays deferred behind baseline
// architecture). A de-padding attempt made earlier in this wave measured the
// two chapters, once de-padded, at 40.72 and 37.78 against the then-shipped
// budget of 35 -- both already over. Independently re-verified against HEAD
// at the current budget of 25: 38.86 and 38.56 against the baseline left
// unchanged, and still 34.80 and 33.08 against a baseline re-captured from
// the de-padded chapters themselves. Whoever unblocks de-padding should
// expect this test, and the CLI test below it, to need rework, not treat a
// new failure here as a regression.

test('golden sample book: EVERY chapter passes its own stylometry check individually, not just the combined book', () => {
  const root = join(EXAMPLES, 'sample-book');
  const config = JSON.parse(readFileSync(join(root, '.studio', 'config.json'), 'utf8'));
  const baseline = config.stylometry.baseline;
  const thresholds = config.thresholds;

  const chapterDir = join(root, 'chapters');
  const chapterFiles = readdirSync(chapterDir).filter(f => f.endsWith('.md')).sort();
  assert.ok(chapterFiles.length >= 2, 'golden book must have at least two chapters to exercise this check');

  for (const file of chapterFiles) {
    const text = readFileSync(join(chapterDir, file), 'utf8');
    const measured = measureChapter(text);
    const { score, exceeded } = computeDrift(measured, baseline, thresholds);
    assert.ok(
      !exceeded,
      'chapter ' + file + ' must pass its OWN stylometry check individually; drift score ' +
      score.toFixed(2) + ' vs threshold ' + thresholds.drift_score_max +
      ' (a whole-book pass does not guarantee a per-chapter pass)'
    );
  }
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
      ' (drift ' + out.driftScore.toFixed(2) + ' vs threshold ' + out.threshold + ')');
  }
});

// ---------------------------------------------------------------------------
// Committed tree: voice-drift fixture (exit 1, first_person_rate flagged)
// ---------------------------------------------------------------------------
//
// Reconciliation outcome (TSK-026): function_word_rate is NOT flagged after
// reconciliation because the passive rewrite removes first/second-person pronouns
// (function words) while adding auxiliary verbs (also function words); the net
// rate change is 0.79%, within the 2% per-marker tolerance band. This is
// documented in voice-drift/PLANTED.md. first_person_rate flags at 100%
// deviation (0 vs 0.2262 baseline). The fixture exits 1 because total score
// (~28, book level, under the roadmap row 1.7 per-marker contribution cap)
// decisively exceeds threshold (20).

test('voice-drift fixture: measureBook + computeDrift exceeds threshold (exit 1)', () => {
  const root = join(EXAMPLES, 'fixtures', 'voice-drift');
  const ch1 = readFileSync(join(root, 'chapters', '01-listening-before-speaking.md'), 'utf8');
  const ch2 = readFileSync(join(root, 'chapters', '02-finding-your-network.md'), 'utf8');
  const config = JSON.parse(readFileSync(join(root, '.studio', 'config.json'), 'utf8'));

  const measured = measureBook([ch1, ch2]);
  const baseline = config.stylometry.baseline;
  const thresholds = config.thresholds;

  const { score, exceeded } = computeDrift(measured, baseline, thresholds);
  assert.strictEqual(exceeded, true,
    'voice-drift drift score ' + score.toFixed(2) + ' must exceed threshold ' + thresholds.drift_score_max);
});

test('voice-drift fixture: first_person_rate is flagged', () => {
  const root = join(EXAMPLES, 'fixtures', 'voice-drift');
  const ch1 = readFileSync(join(root, 'chapters', '01-listening-before-speaking.md'), 'utf8');
  const ch2 = readFileSync(join(root, 'chapters', '02-finding-your-network.md'), 'utf8');
  const config = JSON.parse(readFileSync(join(root, '.studio', 'config.json'), 'utf8'));

  const measured = measureBook([ch1, ch2]);
  const { perMarker } = computeDrift(measured, config.stylometry.baseline, config.thresholds);

  const fp = perMarker.find(m => m.marker === 'first_person_rate');
  assert.ok(fp, 'first_person_rate entry present in perMarker');
  assert.strictEqual(fp.flagged, true,
    'first_person_rate is flagged (drops from ' + fp.baseline + ' to ' + fp.measured + ')');
  assert.strictEqual(fp.measured, 0,
    'first_person_rate measured = 0 in voice-drift (no first-person pronouns)');
});

test('voice-drift fixture CLI: --all --json exits 1', () => {
  const bookRoot = join(EXAMPLES, 'fixtures', 'voice-drift');
  const result = spawnSync(
    process.execPath, [BIN, '--all', '--json'],
    { cwd: bookRoot, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 1,
    'voice-drift CLI exits 1; stderr: ' + result.stderr);

  const out = JSON.parse(result.stdout);
  assert.ok(typeof out.driftScore === 'number', 'driftScore is a number');
  assert.strictEqual(out.verdict, 'block', 'verdict is block');
  assert.ok(out.driftScore >= out.threshold,
    'driftScore ' + out.driftScore.toFixed(2) + ' >= threshold ' + out.threshold);

  // first_person_rate must be flagged (reconciliation-stable flag)
  const fpEntry = Object.entries(out.markers).find(([k]) => k === 'first_person_rate');
  assert.ok(fpEntry, 'first_person_rate present in markers output');
  assert.strictEqual(fpEntry[1].flagged, true, 'first_person_rate flagged in JSON output');
});

// This is the acceptance criterion that distinguishes a corrected metric from a
// disabled one (roadmap row 1.7, voice registers): the planted fixture must still
// exceed its threshold not only at book level but for EVERY chapter measured
// individually, the same per-chapter shape the golden book's own individually-
// passing test above exercises. Chapter 1 is unchanged from the golden baseline
// (PLANTED.md), so this also proves the corrections did not manufacture a false
// pass on the one chapter that carries no planted defect at all.
test('voice-drift fixture CLI: ns-stylometry --chapter=<slug> --json exits 1 for EVERY chapter', () => {
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
      ' (drift ' + out.driftScore.toFixed(2) + ' vs threshold ' + out.threshold + ')');
    assert.ok(out.driftScore >= out.threshold,
      'chapter ' + slug + ' driftScore ' + out.driftScore.toFixed(2) + ' must be >= threshold ' + out.threshold);
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
// CLI exit codes
// ---------------------------------------------------------------------------

test('CLI exits 2 when --project points to non-existent directory', () => {
  const result = spawnSync(
    process.execPath, [BIN, '--project=/nonexistent/path/xyz', '--all'],
    { encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 2, 'bad project path exits 2');
});

// ---------------------------------------------------------------------------
// --measure mode (TSK-037: voice-capture agent)
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
// Correction B: no single marker may contribute more than one third of the
// drift budget to the score (roadmap row 1.7)
// ---------------------------------------------------------------------------
//
// Both tests use synthetic marker vectors, not named real markers, per the
// acceptance criteria.

test('property: no single marker can push the score to the threshold alone, at more than one configured budget', () => {
  const measured = { onlyBad: 999999, stable1: 1, stable2: 1, stable3: 1 };
  const baseline = {
    markers: { onlyBad: 1, stable1: 1, stable2: 1, stable3: 1 },
    marker_set_version: CURRENT_MARKER_SET_VERSION,
  };

  for (const driftScoreMax of [30, 90]) {
    const { score, exceeded, perMarker } = computeDrift(
      measured, baseline, { drift_score_max: driftScoreMax, stylometry_marker_tolerance: 2.0 }
    );
    const bad = perMarker.find(m => m.marker === 'onlyBad');
    assert.ok(
      bad.deviationPct > driftScoreMax,
      'the single marker\'s honest deviation must exceed the whole budget for this to be a meaningful test; got ' +
      bad.deviationPct
    );
    assert.strictEqual(bad.capped, true,
      'the single dominant marker\'s contribution must be recorded as capped');
    assert.ok(
      score <= driftScoreMax / 3 + 1e-9,
      'one marker alone must not push the score past one third of budget ' + driftScoreMax + '; got ' + score
    );
    // Pins the divisor from below as well as above: a hardcoded cap (for example a
    // literal 10, forbidden by the brief) would satisfy the upper-bound assertion
    // above at both budgets in this loop, since 10 <= driftScoreMax / 3 for both 30
    // and 90, without ever proving the cap scales with the configured budget. With
    // only one marker deviating and three stable markers contributing 0, score
    // equals the cap exactly, so asserting equality (not just <=) at more than one
    // budget value is what actually proves the bound is driftScoreMax / 3 and not
    // some fixed number that happens to be small enough to pass at these budgets.
    assert.ok(
      Math.abs(score - driftScoreMax / 3) < 1e-9,
      'a single fully capped marker\'s contribution must equal exactly one third of budget ' +
      driftScoreMax + ', proving the bound scales with the configured budget rather than being ' +
      'a hardcoded number; got ' + score
    );
    assert.strictEqual(exceeded, false,
      'one marker alone must not exceed the threshold at budget ' + driftScoreMax + '; score=' + score);
  }
});

test('computeDrift: deviationPct stays honest (uncapped) even though the marker\'s contribution to score is capped', () => {
  const measured = { onlyMarker: 1000 };
  const baseline = { markers: { onlyMarker: 1 }, marker_set_version: CURRENT_MARKER_SET_VERSION };
  const { score, perMarker } = computeDrift(
    measured, baseline, { drift_score_max: 30, stylometry_marker_tolerance: 2.0 }
  );
  const m = perMarker.find(x => x.marker === 'onlyMarker');
  assert.strictEqual(m.capped, true,
    'this marker\'s contribution must have been capped for the test to be meaningful');
  assert.ok(
    m.deviationPct > score,
    'deviationPct (' + m.deviationPct + ') must exceed the marker\'s capped contribution to the total score (' + score + ')'
  );
});

// ---------------------------------------------------------------------------
// The stale-baseline guard: marker_set_version (roadmap row 1.7)
// ---------------------------------------------------------------------------

test('computeDrift: scoring against a baseline whose marker_set_version does not match the current one fails with a named, actionable error', () => {
  const measured = { x: 1.0 };
  const staleBaseline = { markers: { x: 1.0 }, marker_set_version: 1 };

  assert.throws(
    () => computeDrift(measured, staleBaseline, { drift_score_max: 30, stylometry_marker_tolerance: 2.0 }),
    (err) => {
      assert.strictEqual(err.name, 'StaleBaselineError',
        'error must be a named StaleBaselineError; got ' + err.name);
      assert.ok(err.message.includes('capture-voice'),
        'error message must name capture-voice as the remedy; got: ' + err.message);
      return true;
    }
  );
});

test('computeDrift: a baseline with no marker_set_version field at all is treated as version 1 and rejected as stale', () => {
  const measured = { x: 1.0 };
  const noVersionBaseline = { markers: { x: 1.0 } }; // marker_set_version absent entirely

  assert.throws(
    () => computeDrift(measured, noVersionBaseline, { drift_score_max: 30, stylometry_marker_tolerance: 2.0 }),
    /capture-voice/,
    'an absent marker_set_version field must be treated as version 1 and rejected as stale'
  );
});
