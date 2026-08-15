// tests/engines/stylometry-calibration.test.mjs
// what-it-is:   the labeled ground-truth scenario suite for the drift budget recalibration
// what-it-does: scores every fixture under tests/engines/fixtures/drift-scenarios/ (frozen,
//               self-contained -- see that directory's SCENARIOS.md) against the shipped
//               engine default (thresholds passed as null throughout, so this suite always
//               tests whatever DEFAULT_DRIFT_SCORE_MAX currently is, never a number
//               hardcoded a second time in this file) and asserts the expected verdict.
//               Two rows (the honest-variance chapters) assert the MEASURED verdict, which
//               diverges from ground truth -- that divergence is the documented structural
//               finding this recalibration could close for the ghostwriting signature but
//               not for natural author variation; see SCENARIOS.md for the full reasoning.
// why:          the review that triggered this task found that shrinking the drift score's
//               scale (marker_set_version 2) without recalibrating the budget let a chapter
//               stripped of every contraction and every first-person pronoun -- the canonical
//               ghostwriting signature -- pass. This suite is the measuring instrument that
//               calibration was fitted against, committed so the fit is falsifiable rather
//               than a number nobody measured.
// runner:       node --test tests/engines/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  measureChapter, measureBook, computeDrift, DEFAULT_DRIFT_SCORE_MAX,
} from '../../hooks/lib/stylometry-engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, 'fixtures', 'drift-scenarios');
const CHAPTERS = join(FIXTURES, 'chapters');

// Frozen golden-book baseline, copied 2026-08-15 -- see SCENARIOS.md for why this directory
// does not read examples/ live.
const baseline = JSON.parse(readFileSync(join(FIXTURES, 'baseline.json'), 'utf8'));

function scoreScenario(filename, base = baseline) {
  const text = readFileSync(join(CHAPTERS, filename), 'utf8');
  const measured = measureChapter(text);
  // thresholds omitted (null): exercises the engine's own shipped default (the
  // computeDrift fallback, DEFAULT_DRIFT_SCORE_MAX) rather than a number this test file
  // would otherwise have to hardcode and keep in sync by hand.
  return computeDrift(measured, base, null);
}

// ---------------------------------------------------------------------------
// The pinned constant. Strict equality rejects every value but 25 in either direction --
// a stronger pin than an inequality can give, and the same shape the acceptance criteria
// ask for after Task 2's bound test was caught asserting only an upper bound.
// ---------------------------------------------------------------------------

test('DEFAULT_DRIFT_SCORE_MAX is exactly 25', () => {
  assert.strictEqual(DEFAULT_DRIFT_SCORE_MAX, 25,
    'the recalibrated default drift budget must be exactly 25, not a neighboring value -- ' +
    'see the DEFAULT_DRIFT_SCORE_MAX doc comment in hooks/lib/stylometry-engine.mjs for the ' +
    'reasoning this was chosen from');
});

// ---------------------------------------------------------------------------
// The engine constant alone is not the whole calibration: three data files and one
// re-exported constant each carry their own copy of the chosen value, and a strict-equality
// pin on DEFAULT_DRIFT_SCORE_MAX above proves nothing about any of them. Every one of these
// could silently drift back to 35 (a bad merge, a reverted line, a stale re-export) without
// failing a single other test in this suite, because the suite above always reads
// DEFAULT_DRIFT_SCORE_MAX itself, never one of these copies. This is exactly the
// "passes silently" shape the acceptance criteria warn about, so each copy gets its own
// strict-equality assertion against the single source of truth. Reading these four files is
// a narrow, deliberate exception to "no live reads from examples/" elsewhere in this suite:
// unlike the frozen chapter/baseline fixtures, these are THIS task's own deployed artifacts,
// not content a later de-padding task is expected to change.
// ---------------------------------------------------------------------------

test('templates/config-defaults.json ships drift_score_max equal to DEFAULT_DRIFT_SCORE_MAX', () => {
  const config = JSON.parse(readFileSync(join(__dirname, '..', '..', 'templates', 'config-defaults.json'), 'utf8'));
  assert.strictEqual(config.thresholds.drift_score_max, DEFAULT_DRIFT_SCORE_MAX,
    'the shipped default config must match the engine default exactly, not silently diverge');
});

test('templates/book-scaffold/.studio/config.json ships drift_score_max equal to DEFAULT_DRIFT_SCORE_MAX', () => {
  const config = JSON.parse(readFileSync(
    join(__dirname, '..', '..', 'templates', 'book-scaffold', '.studio', 'config.json'), 'utf8'
  ));
  assert.strictEqual(config.thresholds.drift_score_max, DEFAULT_DRIFT_SCORE_MAX,
    'the book-scaffold template config must match the engine default exactly, not silently diverge');
});

test('examples/sample-book/.studio/config.json ships drift_score_max equal to DEFAULT_DRIFT_SCORE_MAX', () => {
  const config = JSON.parse(readFileSync(
    join(__dirname, '..', '..', 'examples', 'sample-book', '.studio', 'config.json'), 'utf8'
  ));
  assert.strictEqual(config.thresholds.drift_score_max, DEFAULT_DRIFT_SCORE_MAX,
    'the golden example config must match the engine default exactly, not silently diverge ' +
    '(the literal 25 in tests/engines/status-cli.test.mjs pins the same value from the CLI ' +
    'side; this pins it from the constant side, so a mismatch between the two is caught)');
});

test('status-engine.mjs re-exports the SAME value as DEFAULT_DRIFT_SCORE_MAX, not an independent copy', async () => {
  const { DEFAULT_DRIFT_THRESHOLD } = await import('../../hooks/lib/status-engine.mjs');
  assert.strictEqual(DEFAULT_DRIFT_THRESHOLD, DEFAULT_DRIFT_SCORE_MAX,
    'status-engine.mjs must derive its default from the engine constant, not carry its own ' +
    'literal that could drift out of sync (this is exactly what a merge-conflict resolution ' +
    'on a concurrently-edited file could silently reintroduce)');
});

test('before/after: the ghostwriting scenario passed at the old default (35) and blocks at the new default', () => {
  const measured = measureChapter(
    readFileSync(join(CHAPTERS, '01-contractions-and-first-person-removed.md'), 'utf8')
  );
  const atOld = computeDrift(measured, baseline, { drift_score_max: 35, stylometry_marker_tolerance: 2.0 });
  const atNew = computeDrift(measured, baseline, { drift_score_max: DEFAULT_DRIFT_SCORE_MAX, stylometry_marker_tolerance: 2.0 });
  assert.strictEqual(atOld.exceeded, false,
    'documents the regression this task exists to close: at the old default (35) this scenario passed (score ' +
    atOld.score.toFixed(2) + ')');
  assert.strictEqual(atNew.exceeded, true,
    'proves the fix: at the new default this scenario blocks (score ' + atNew.score.toFixed(2) + ')');
});

// ---------------------------------------------------------------------------
// Main scenario table. See fixtures/drift-scenarios/SCENARIOS.md for the transformation
// methodology and the full before/after score table.
// ---------------------------------------------------------------------------

const SCENARIOS = [
  { file: '01-unchanged.md', label: 'unchanged chapter, zero real drift', expected: 'pass' },
  { file: '01-contractions-removed.md', label: 'contractions removed (single axis)', expected: 'pass' },
  { file: '01-first-person-removed.md', label: 'first-person voice removed (single axis)', expected: 'pass' },
  { file: '01-second-person-removed.md', label: 'second-person voice removed (single axis)', expected: 'pass' },
  {
    file: '01-contractions-and-first-person-removed.md',
    label: 'contractions + first person removed -- the ghostwriting signature (THE regression this task closes)',
    expected: 'block',
  },
  {
    file: '01-first-and-second-person-removed.md',
    label: 'first + second person removed -- same marker count as the row above, quiet residual (see SCENARIOS.md)',
    expected: 'pass',
  },
  { file: '01-contractions-first-second-removed.md', label: 'contractions + first + second person all removed', expected: 'block' },
  { file: 'different-voice.md', label: 'genuinely different authorial voice (voice-drift fixture ch2, copied static)', expected: 'block' },
];

for (const s of SCENARIOS) {
  test('scenario: ' + s.label + ' -> ' + s.expected, () => {
    const { score, exceeded } = scoreScenario(s.file);
    const verdict = exceeded ? 'block' : 'pass';
    assert.strictEqual(verdict, s.expected,
      s.label + ': expected ' + s.expected + ', got ' + verdict + ' (score ' + score.toFixed(2) + ')');
  });
}

// ---------------------------------------------------------------------------
// Honest-variance: ground truth PASS, measured verdict BLOCK. See SCENARIOS.md's
// "Honest-variance scenario" section for the full reasoning. This suite asserts the
// MEASURED verdict deliberately -- asserting the ground truth here would make the suite
// lie about what the shipped calibration actually does; omitting the row would hide the
// finding instead of disclosing it.
// ---------------------------------------------------------------------------

const ch1Depadded = readFileSync(join(CHAPTERS, '01-honest-variance-depadded.md'), 'utf8');
const ch2Depadded = readFileSync(join(CHAPTERS, '02-honest-variance-depadded.md'), 'utf8');
const selfFitBaseline = {
  markers: measureBook([ch1Depadded, ch2Depadded]),
  marker_set_version: baseline.marker_set_version,
};

test('honest-variance ch1 (de-padded, self-fit baseline): ground truth PASS, measured verdict BLOCK -- structural finding, not a defect in this calibration', () => {
  const { score, exceeded } = computeDrift(measureChapter(ch1Depadded), selfFitBaseline, null);
  assert.strictEqual(exceeded, true,
    'measured verdict is block under the shipped default (score ' + score.toFixed(2) + '). Ground truth is pass: ' +
    'two honestly written chapters differing naturally should not block. No swept budget or divisor closes this ' +
    'gap for this corpus -- see the "Honest-variance scenario" section of SCENARIOS.md for the proof.');
});

test('honest-variance ch2 (de-padded, self-fit baseline): same finding as ch1', () => {
  const { score, exceeded } = computeDrift(measureChapter(ch2Depadded), selfFitBaseline, null);
  assert.strictEqual(exceeded, true,
    'measured verdict is block under the shipped default (score ' + score.toFixed(2) + '); ground truth is pass, ' +
    'same structural finding as chapter 1');
});

test('honest-variance, BOOK level: stays near zero -- the self-fit baseline absorbs both chapters, so the finding above is a per-chapter phenomenon, not a book-level one', () => {
  const bookMeasured = measureBook([ch1Depadded, ch2Depadded]);
  const { score, exceeded } = computeDrift(bookMeasured, selfFitBaseline, null);
  assert.strictEqual(exceeded, false, 'book-level score must stay well within budget; got ' + score.toFixed(4));
  assert.ok(score < 0.1, 'book-level score should be near zero (self-fit population); got ' + score.toFixed(4));
});

// ---------------------------------------------------------------------------
// Margin and floor-fraction visibility (acceptance criteria: the unchanged chapter's pass
// margin, and the zero-drift floor, must both be stated as a fraction of budget rather than
// left implicit).
// ---------------------------------------------------------------------------

test('unchanged chapter passes with a stated margin: more than half of budget remains headroom', () => {
  const { score } = scoreScenario('01-unchanged.md');
  const margin = (DEFAULT_DRIFT_SCORE_MAX - score) / DEFAULT_DRIFT_SCORE_MAX;
  assert.ok(margin > 0.5,
    'margin should be a comfortable majority of budget; got ' + (margin * 100).toFixed(1) + '% (score ' + score.toFixed(2) + ')');
});

test('zero-drift floor is a stated, non-trivial fraction of budget (43.4%) -- visible, not ignored', () => {
  const { score } = scoreScenario('01-unchanged.md');
  const floorFraction = score / DEFAULT_DRIFT_SCORE_MAX;
  assert.ok(Math.abs(floorFraction - 0.434) < 0.01,
    'zero-drift floor fraction drifted from the value the report states; got ' + (floorFraction * 100).toFixed(1) + '%');
});
