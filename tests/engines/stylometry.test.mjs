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

import { measureChapter, measureBook, computeDrift } from '../../hooks/lib/stylometry-engine.mjs';

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
// computeDrift: zero-baseline rule
// ---------------------------------------------------------------------------

test('computeDrift: zero-baseline with zero measured gives 0 deviationPct', () => {
  const measured  = { marker_a: 0, marker_b: 1.0 };
  const baseline  = { marker_a: 0, marker_b: 1.0 };
  const { perMarker } = computeDrift(measured, baseline, { drift_score_max: 10, stylometry_marker_tolerance: 2.0 });
  const ma = perMarker.find(m => m.marker === 'marker_a');
  assert.strictEqual(ma.deviationPct, 0, 'zero baseline / zero measured -> deviationPct 0');
  assert.strictEqual(ma.flagged, false, 'deviationPct 0 is not flagged');
});

test('computeDrift: zero-baseline with non-zero measured gives 100 deviationPct', () => {
  const measured = { marker_a: 5.0 };
  const baseline = { marker_a: 0 };
  const { perMarker } = computeDrift(measured, baseline, { drift_score_max: 10, stylometry_marker_tolerance: 2.0 });
  const ma = perMarker.find(m => m.marker === 'marker_a');
  assert.strictEqual(ma.deviationPct, 100, 'zero baseline / non-zero measured -> deviationPct 100');
  assert.strictEqual(ma.flagged, true, 'deviationPct 100 is flagged (exceeds 2% band)');
});

test('computeDrift: exceeded is true when score >= drift_score_max', () => {
  const baseline = { x: 1.0 };
  const measured = { x: 100.0 };
  const { exceeded, score } = computeDrift(measured, baseline,
    { drift_score_max: 10, stylometry_marker_tolerance: 2.0 });
  assert.ok(score > 10, 'score should be large');
  assert.strictEqual(exceeded, true, 'exceeded is true when score >= threshold');
});

test('computeDrift: exceeded is false when score < drift_score_max', () => {
  const baseline = { x: 1.0 };
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
  const baseline = config.stylometry.baseline.markers;
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
// Committed tree: voice-drift fixture (exit 1, first_person_rate flagged)
// ---------------------------------------------------------------------------
//
// Reconciliation outcome (TSK-026): function_word_rate is NOT flagged after
// reconciliation because the passive rewrite removes first/second-person pronouns
// (function words) while adding auxiliary verbs (also function words); the net
// rate change is 0.78%, within the 2% per-marker tolerance band. This is
// documented in voice-drift/PLANTED.md. first_person_rate flags at 100%
// deviation (0 vs 0.2268 baseline). The fixture exits 1 because total score
// (~207) decisively exceeds threshold (20).

test('voice-drift fixture: measureBook + computeDrift exceeds threshold (exit 1)', () => {
  const root = join(EXAMPLES, 'fixtures', 'voice-drift');
  const ch1 = readFileSync(join(root, 'chapters', '01-listening-before-speaking.md'), 'utf8');
  const ch2 = readFileSync(join(root, 'chapters', '02-finding-your-network.md'), 'utf8');
  const config = JSON.parse(readFileSync(join(root, '.studio', 'config.json'), 'utf8'));

  const measured = measureBook([ch1, ch2]);
  const baseline = config.stylometry.baseline.markers;
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
  const { perMarker } = computeDrift(measured, config.stylometry.baseline.markers, config.thresholds);

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
