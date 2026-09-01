// tests/engines/stylometry-explain.test.mjs
// what-it-is:   CLI-level tests for `ns-stylometry --explain`
// what-it-does: proves the explain flag renders every marker (baseline, measured, honest
//               deviation, the SIGNED standardized deviation z, and whether it crossed the
//               per-marker tolerance band) ordered by |z| descending; that the marker driving
//               the verdict statistic is named and its z is the largest in magnitude; that the
//               rendering is deterministic and locale-independent; that it writes nothing to
//               disk; that it composes with the existing text and --json modes without changing
//               the exit-code taxonomy; and that a JSON consumer who never passes --explain sees
//               byte-for-byte the same shape as before this flag existed. The fix-round tests
//               near the end of this file prove text mode restores the flagged signal the
//               pre-existing flagged-markers-only loop carried by construction, which the first
//               version of this flag silently dropped.
// why:          the drift statistic was opaque -- a marker's honest deviation and its signed
//               standardized deviation (z) could disagree in direction with no way for an author
//               to see why. computeDrift already computes both; this flag surfaces them.
// fixtures:     GOLDEN-book-shaped tests clone examples/sample-book and patch the clone with a
//               synthetic, self-consistent v5 baseline (writeSyntheticV5Baseline: measured from
//               the clone's own chapters, so every marker's z is 0 on unchanged content) --
//               examples/sample-book/.studio/config.json still carries a marker_set_version 4
//               baseline with no calibration ladder (Task 5, ADR-0012 implementation wave,
//               recaptures it), and none of these tests' own intent depends on the golden book's
//               REAL voice. The marker-breakdown tests (capped/ordering/flagged-signal/tolerance)
//               need a KNOWN, large, one-marker-dominant deviation to assert against; rather than
//               depend on examples/fixtures/voice-drift's real committed baseline (also still v4,
//               and whose specific documented numbers are Task 5's territory, not this task's),
//               buildSyntheticExplainBook constructs its OWN hand-built book root with a planted
//               defect of the SAME shape (first_person_rate collapsing to a zero-baseline
//               100% deviation is the documented voice-drift shape too -- PLANTED.md), built
//               fresh so this suite never depends on the real fixture's own recapture. Every run
//               below uses a TEMP directory, never the committed tree in place (the fixture suite
//               in scripts/test-fixtures.mjs asserts examples/ stays byte-clean).
// runner:       node --test tests/engines/stylometry-explain.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, readdirSync, statSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { writeSyntheticV5Baseline } from '../lib/synthetic-v5-baseline.mjs';
import { measureChapter } from '../../hooks/lib/stylometry-engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EXAMPLES = join(__dirname, '..', '..', 'examples');
const BIN = join(__dirname, '..', '..', 'bin', 'ns-stylometry');
const GOLDEN_SRC = join(EXAMPLES, 'sample-book');

// ---------------------------------------------------------------------------
// Scratch clone / build helpers (never run the CLI against examples/ in place)
// ---------------------------------------------------------------------------

function cloneFixture(sourceDir, label) {
  const prefix = 'ns-stylometry-explain-' + label + '-';
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cpSync(sourceDir, dir, { recursive: true });
  writeSyntheticV5Baseline(dir, { regime: 'chapter' });
  return dir;
}

function cleanupClone(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup only
  }
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

// Recursive snapshot of relative file paths and mtimes, for read-only proof.
function snapshot(rootDir) {
  const entries = [];
  function walk(dir, relBase) {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const rel = relBase ? relBase + '/' + name : name;
      const st = statSync(abs);
      if (st.isDirectory()) {
        entries.push(rel + '/');
        walk(abs, rel);
      } else {
        entries.push(rel + '@' + st.mtimeMs);
      }
    }
  }
  walk(rootDir, '');
  return entries.join('\n');
}

// ---------------------------------------------------------------------------
// buildSyntheticExplainBook: a hand-built book root (NOT a clone of any committed fixture)
// carrying a KNOWN, planted single-marker-dominant drift, the same shape voice-drift's real
// PLANTED.md defect takes (first_person_rate collapsing to a zero-baseline 100% deviation) but
// constructed fresh so this suite never depends on Task 5's fixture recapture.
//
// BASE_TEXT and DRIFTED_TEXT differ by SCENARIOS.md's own methodology (tests/engines/fixtures/
// drift-scenarios/SCENARIOS.md): first- and second-person pronouns substituted to third-person
// plural, and the one contraction expanded -- disturbing everything else as little as possible.
// The baseline is measureChapter(BASE_TEXT) exactly (so BASE_TEXT scored against its own
// baseline is z = 0 everywhere); DRIFTED_TEXT's first_person_rate and second_person_rate both
// collapse to exactly 0 against a nonzero baseline (a zero-baseline collapse: deviationPct
// exactly 100, the same shape as Task 3's own "computeDrift v5: a blocking case" test), and
// contraction_rate does too. The calibration ladder gives first_person_rate a tight noise scale
// (1.0) and every other marker a generous one (50.0), so first_person_rate is unambiguously the
// worst (largest |z|) marker without depending on exactly how the other markers move.
// ---------------------------------------------------------------------------

const BASE_TEXT =
  "I think about my own habits when I listen to you. You bring your questions and I try to answer honestly. " +
  "We often forget that our best conversations don't start without a little patience. " +
  "It is easy to assume you already understand what I mean, but that is rarely true. " +
  "I would rather ask you directly than guess at your intent. You deserve that much from me. " +
  "My habit of listening first has served me well, and I recommend it to anyone who will hear it. " +
  "We build trust one honest exchange at a time, and I believe you can feel the difference. ";

function driftedText(text) {
  return text
    .replace(/\bI\b/g, 'they').replace(/\bmy\b/gi, 'their').replace(/\bme\b/gi, 'them')
    .replace(/\bwe\b/gi, 'they').replace(/\bour\b/gi, 'their')
    .replace(/\byou\b/gi, 'they').replace(/\byour\b/gi, 'their')
    .replace(/don't/gi, 'do not');
}

const DRIFTED_TEXT = driftedText(BASE_TEXT);

const TOPOLOGY_MARKER_NAMES = [
  'function_word_rate', 'contraction_rate', 'first_person_rate', 'second_person_rate',
  'type_token_ratio', 'avg_word_length', 'avg_sentence_length', 'punctuation_rate',
];

function explainScales(firstPersonScale) {
  const scales = {};
  for (const marker of TOPOLOGY_MARKER_NAMES) {
    scales[marker] = marker === 'first_person_rate' ? firstPersonScale : 50.0;
  }
  return scales;
}

function buildSyntheticExplainBook() {
  const dir = mkdtempSync(join(tmpdir(), 'ns-stylometry-explain-synth-'));
  mkdirSync(join(dir, '.studio'), { recursive: true });
  mkdirSync(join(dir, 'context'), { recursive: true });
  mkdirSync(join(dir, 'chapters'), { recursive: true });
  writeFileSync(join(dir, '.studio', 'meta.json'), JSON.stringify({ schema_version: 2 }, null, 2), 'utf8');
  writeFileSync(join(dir, 'chapters', '01-drifted.md'), DRIFTED_TEXT, 'utf8');

  const baseline = {
    markers: measureChapter(BASE_TEXT),
    marker_set_version: 5,
    captured: '2026-08-30T00:00:00Z',
    sample_count: 1,
    calibration: {
      spans: [550, 2200],
      noise_scales: { '550': explainScales(1.0), '2200': explainScales(1.0) },
      block_thresholds: { '550': 3.0, '2200': 3.0 },
      detectability_auc: 0.98,
      regime: 'chapter',
      replicates: 300,
      seed: 4242,
    },
  };
  const config = {
    version: 2,
    thresholds: { stylometry_marker_tolerance: 2.0 },
    stylometry: { baseline },
  };
  writeFileSync(join(dir, '.studio', 'config.json'), JSON.stringify(config, null, 2), 'utf8');
  return dir;
}

// ---------------------------------------------------------------------------
// Sanity check on the fixture-construction claims made in the comment block above.
// ---------------------------------------------------------------------------

test('fixture sanity: DRIFTED_TEXT collapses first_person_rate to exactly 0 against a nonzero baseline', () => {
  const baseline = measureChapter(BASE_TEXT);
  const drifted = measureChapter(DRIFTED_TEXT);
  assert.ok(baseline.first_person_rate > 0, 'precondition: baseline first_person_rate must be nonzero');
  assert.strictEqual(drifted.first_person_rate, 0, 'drifted text must have zero first-person pronouns');
});

// ---------------------------------------------------------------------------
// AC: a marker whose z drives the verdict statistic, with its full breakdown rendered.
// first_person_rate's deviationPct is exactly 100 by construction (zero-baseline collapse,
// baseline nonzero, measured 0), well past this fixture's per-marker tolerance (2.0%).
// ---------------------------------------------------------------------------

test('--explain --json: the worst marker (largest |z|) reports deviationPct 100 and is flagged', () => {
  const dir = buildSyntheticExplainBook();
  try {
    const result = run(['--all', '--json', '--explain'], dir);
    assert.strictEqual(result.status, 1,
      'the synthetic planted-defect book must exit 1 (exceeds); stderr: ' + result.stderr);

    const out = JSON.parse(result.stdout);
    assert.ok(out.explain, 'JSON output must carry an explain block when --explain is passed');
    assert.ok(Array.isArray(out.explain.perMarker), 'explain.perMarker must be an array');
    assert.strictEqual(out.worstMarker, 'first_person_rate');

    const fp = out.explain.perMarker.find(m => m.marker === 'first_person_rate');
    assert.ok(fp, 'first_person_rate must be present in explain.perMarker');
    assert.strictEqual(fp.deviationPct, 100, 'first_person_rate honest deviation must be exactly 100 (baseline nonzero, measured 0)');
    assert.strictEqual(fp.capped, undefined, 'the v4 "capped" field must not exist on a v5 perMarker entry');
    assert.strictEqual(fp.contribution, undefined, 'the v4 "contribution" field must not exist on a v5 perMarker entry');
    assert.strictEqual(fp.flagged, true, 'first_person_rate must be flagged (100% deviation clears the 2% band)');
    assert.strictEqual(typeof fp.z, 'number', 'z must be a number');
    for (const m of out.explain.perMarker) {
      assert.ok(Math.abs(m.z) <= Math.abs(fp.z), 'first_person_rate must carry the largest |z|; ' + m.marker + ' z=' + m.z + ' vs fp.z=' + fp.z);
    }
  } finally {
    cleanupClone(dir);
  }
});

test('--explain (text): the output names the worst marker and its honest deviation', () => {
  const dir = buildSyntheticExplainBook();
  try {
    const result = run(['--all', '--explain'], dir);
    assert.strictEqual(result.status, 1, 'stderr: ' + result.stderr);

    assert.ok(result.stdout.includes('first_person_rate'),
      'text output must name first_person_rate; got:\n' + result.stdout);
    assert.ok(result.stdout.includes('Worst marker'),
      'text output must state which marker is worst, in words; got:\n' + result.stdout);
    assert.ok(result.stdout.includes('100.00'),
      'text output must show the honest deviation 100.00 for first_person_rate; got:\n' + result.stdout);
  } finally {
    cleanupClone(dir);
  }
});

// ---------------------------------------------------------------------------
// AC: every marker rendered, ordered by |z| descending
// ---------------------------------------------------------------------------

test('--explain --json: explain.perMarker covers all 8 markers with the required fields, ordered by |z| descending', () => {
  const dir = buildSyntheticExplainBook();
  try {
    const result = run(['--all', '--json', '--explain'], dir);
    assert.strictEqual(result.status, 1, 'stderr: ' + result.stderr);

    const out = JSON.parse(result.stdout);
    const list = out.explain.perMarker;
    assert.strictEqual(list.length, 8, 'explain.perMarker must cover all 8 markers; got ' + list.length);

    for (const m of list) {
      assert.strictEqual(typeof m.marker, 'string', 'marker name must be a string');
      assert.strictEqual(typeof m.baseline, 'number', m.marker + ': baseline must be a number');
      assert.strictEqual(typeof m.measured, 'number', m.marker + ': measured must be a number');
      assert.strictEqual(typeof m.deviationPct, 'number', m.marker + ': deviationPct must be a number');
      assert.strictEqual(typeof m.z, 'number', m.marker + ': z must be a number');
      assert.strictEqual(typeof m.flagged, 'boolean', m.marker + ': flagged must be a boolean');
    }

    for (let i = 1; i < list.length; i++) {
      assert.ok(Math.abs(list[i - 1].z) >= Math.abs(list[i].z),
        'explain.perMarker must be ordered by |z| descending; position ' + (i - 1) +
        ' (' + list[i - 1].marker + '=' + list[i - 1].z + ') is less than position ' +
        i + ' (' + list[i].marker + '=' + list[i].z + ')');
    }
  } finally {
    cleanupClone(dir);
  }
});

// ---------------------------------------------------------------------------
// AC: deterministic and locale-independent -- run twice, compare bytes.
// Text mode only (no --json): the JSON envelope carries a `ts` timestamp that legitimately
// differs between two real invocations, so byte-comparing full JSON output would not test what
// this criterion means. Text mode carries no timestamp, matching the convention
// hooks/lib/statusline-engine.mjs already uses for its own deterministic output.
// ---------------------------------------------------------------------------

test('--explain (text): output is byte-identical across two separate runs against the same input', () => {
  const clone = cloneFixture(GOLDEN_SRC, 'determinism');
  try {
    const result1 = run(['--chapter=01-listening-before-speaking', '--explain'], clone);
    assert.strictEqual(result1.status, 0, 'stderr: ' + result1.stderr);
    assert.ok(result1.stdout.length > 0, 'explain output must not be empty');
    // Content sanity check (not just "two empty strings match"): the ranked breakdown must
    // actually be present.
    assert.ok(/function_word_rate|type_token_ratio|avg_sentence_length/.test(result1.stdout),
      'explain text must name at least one marker; got:\n' + result1.stdout);

    const result2 = run(['--chapter=01-listening-before-speaking', '--explain'], clone);
    assert.strictEqual(result2.status, 0, 'stderr: ' + result2.stderr);

    assert.strictEqual(result1.stdout, result2.stdout,
      'explain text output must be byte-identical across two runs against the same input');
  } finally {
    cleanupClone(clone);
  }
});

// ---------------------------------------------------------------------------
// AC: --explain writes nothing
// ---------------------------------------------------------------------------

test('--explain writes nothing to disk', () => {
  const clone = cloneFixture(GOLDEN_SRC, 'readonly');
  try {
    const before = snapshot(clone);

    const result = run(['--all', '--explain', '--json'], clone);
    assert.strictEqual(result.status, 0, 'stderr: ' + result.stderr);
    const out = JSON.parse(result.stdout);
    assert.ok(out.explain, 'explain block must be present in JSON output');

    const after = snapshot(clone);
    assert.strictEqual(after, before, '--explain must not create, delete, or modify any file in the project');
  } finally {
    cleanupClone(clone);
  }
});

// ---------------------------------------------------------------------------
// AC: composes with the existing modes; exit-code taxonomy is unchanged
// ---------------------------------------------------------------------------

test('exit code is identical with and without --explain: golden book (pass, synthetic self-consistent baseline)', () => {
  const clone = cloneFixture(GOLDEN_SRC, 'parity-pass');
  try {
    const without = run(['--all'], clone);
    const withExplain = run(['--all', '--explain'], clone);
    assert.strictEqual(without.status, 0, 'stderr: ' + without.stderr);
    assert.strictEqual(withExplain.status, without.status,
      '--explain must not change the exit code; without=' + without.status + ' with=' + withExplain.status +
      '; stderr: ' + withExplain.stderr);
  } finally {
    cleanupClone(clone);
  }
});

test('exit code is identical with and without --explain: synthetic planted-defect book (block)', () => {
  const dir = buildSyntheticExplainBook();
  try {
    const without = run(['--all'], dir);
    const withExplain = run(['--all', '--explain'], dir);
    assert.strictEqual(without.status, 1, 'stderr: ' + without.stderr);
    assert.strictEqual(withExplain.status, without.status,
      '--explain must not change the exit code; without=' + without.status + ' with=' + withExplain.status +
      '; stderr: ' + withExplain.stderr);
  } finally {
    cleanupClone(dir);
  }
});

test('exit code and error message are identical with and without --explain on the operational-error path (stale baseline)', () => {
  const clone = cloneFixture(GOLDEN_SRC, 'parity-error');
  try {
    const staleBaselinePath = join(clone, 'stale-baseline.json');
    writeFileSync(staleBaselinePath, JSON.stringify({ markers: { x: 1 }, marker_set_version: 1 }), 'utf8');

    const without = run(['--all', '--baseline=' + staleBaselinePath], clone);
    const withExplain = run(['--all', '--baseline=' + staleBaselinePath, '--explain'], clone);

    assert.strictEqual(without.status, 2, 'a stale baseline must exit 2; stderr: ' + without.stderr);
    assert.ok(without.stderr.includes('nfs-capture-voice'),
      'stale-baseline error must name nfs-capture-voice as the remedy; stderr: ' + without.stderr);

    assert.strictEqual(withExplain.status, 2,
      '--explain must not change the exit code on the operational-error path; stderr: ' + withExplain.stderr);
    assert.ok(withExplain.stderr.includes('nfs-capture-voice'),
      '--explain must reach the same stale-baseline error, not a different one; stderr: ' + withExplain.stderr);

    assert.strictEqual(withExplain.stderr, without.stderr,
      '--explain must not alter the operational-error message at all');
  } finally {
    cleanupClone(clone);
  }
});

// ---------------------------------------------------------------------------
// Judgment call: what --explain does when there is no meaningful statistic to explain (zero
// chapters). Chosen: a stated reason, not silence, matching how this CLI already behaves for the
// same zero-chapter case without --explain.
// ---------------------------------------------------------------------------

test('--explain with zero chapters: states a reason rather than staying silent, and the exit code is unchanged', () => {
  const clone = cloneFixture(GOLDEN_SRC, 'zero-chapters');
  try {
    const chapterDir = join(clone, 'chapters');
    for (const f of readdirSync(chapterDir)) {
      if (f.endsWith('.md')) unlinkSync(join(chapterDir, f));
    }

    const without = run(['--all'], clone);
    assert.strictEqual(without.status, 0, 'stderr: ' + without.stderr);
    assert.ok(without.stdout.includes('no chapters to scan'), 'got: ' + without.stdout);

    const withExplain = run(['--all', '--explain'], clone);
    assert.strictEqual(withExplain.status, 0,
      '--explain must not change the exit code for the zero-chapter case; stderr: ' + withExplain.stderr);
    assert.ok(withExplain.stdout.includes('no chapters to scan'),
      '--explain must still show the existing message (composes, does not replace); got: ' + withExplain.stdout);
    assert.notStrictEqual(withExplain.stdout, without.stdout,
      '--explain must add a stated reason beyond the base message, not stay silent; got: ' + withExplain.stdout);

    const withJson = run(['--all', '--explain', '--json'], clone);
    assert.strictEqual(withJson.status, 0, 'stderr: ' + withJson.stderr);
    const out = JSON.parse(withJson.stdout);
    assert.ok(out.explain, 'JSON must still carry an explain block for the zero-chapter case');
    assert.deepStrictEqual(out.explain.perMarker, [], 'no markers were measured, so perMarker must be empty');
    assert.strictEqual(typeof out.explain.note, 'string',
      'JSON explain block must carry a stated reason (string note), not silence');
    assert.ok(out.explain.note.length > 0, 'the stated reason must not be an empty string');
  } finally {
    cleanupClone(clone);
  }
});

// ---------------------------------------------------------------------------
// Backward compatibility: a consumer of the existing --json output who never passes --explain
// must see byte-for-byte the same shape as before this flag existed. This is a standing
// invariant, not a red/green feature test: it is expected to hold both before and after this
// change.
// ---------------------------------------------------------------------------

test('--json without --explain carries no explain key at all', () => {
  const clone = cloneFixture(GOLDEN_SRC, 'no-explain-key');
  try {
    const result = run(['--chapter=01-listening-before-speaking', '--json'], clone);
    assert.strictEqual(result.status, 0, 'stderr: ' + result.stderr);
    const out = JSON.parse(result.stdout);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(out, 'explain'), false,
      'a consumer that never passes --explain must see no explain key at all, not an empty or null one');
  } finally {
    cleanupClone(clone);
  }
});

// ---------------------------------------------------------------------------
// Fix round 1: text-mode --explain must restore the flagged signal the pre-existing
// flagged-markers-only loop carried by construction (every line it printed was, by definition, a
// marker that had crossed the tolerance band). --explain lists every marker, not only the
// flagged ones, so that signal has to be stated explicitly per marker rather than left implicit
// in which rows appear. The synthetic fixture's flagged set is structural to its planted defect
// (SCENARIOS.md-style substitution), not incidental: first_person_rate, second_person_rate, and
// contraction_rate are the three markers the transformation directly moves past the 2.0%
// tolerance band (each a zero-baseline collapse, exactly 100% deviation); avg_word_length and
// function_word_rate cross it as a knock-on effect of the word-count shift the substitution
// causes; avg_sentence_length and punctuation_rate do not move at all.
// ---------------------------------------------------------------------------

// Finds the RANKED-TABLE row for a marker, not just any line mentioning its name: the "Worst
// marker: <marker>, z=..." summary line also contains the worst marker's name, and (as the
// analogous v4 version of this test discovered against a real run) the fixture's worst marker by
// |z| happens to be one of the flagged markers under test, so a naive substring search on the
// whole stdout finds that summary line first and never reaches the actual table row at all. A
// table row's content, once an optional leading "* " is stripped, starts with the marker name;
// the summary line's does not.
function findMarkerRow(stdout, marker) {
  return stdout.split('\n').find(line => line.replace(/^\*?\s*/, '').startsWith(marker));
}

test('--explain (text): every flagged marker\'s row is marked, every unflagged marker\'s row is not', () => {
  const dir = buildSyntheticExplainBook();
  try {
    const result = run(['--all', '--explain'], dir);
    assert.strictEqual(result.status, 1, 'stderr: ' + result.stderr);

    // Computed once, at fixture-authorship time, directly from the same engine this test
    // exercises (measureChapter against BASE_TEXT/DRIFTED_TEXT above); not asserted blind.
    const measured = measureChapter(DRIFTED_TEXT);
    const baseline = measureChapter(BASE_TEXT);
    const tolerance = 2.0;
    const flaggedMarkers = [];
    const unflaggedMarkers = [];
    for (const marker of TOPOLOGY_MARKER_NAMES) {
      const b = baseline[marker];
      const m = measured[marker];
      const relDev = b === 0 ? (m === 0 ? 0 : 100) : (m - b) / b * 100;
      const deviationPct = Math.abs(relDev);
      (deviationPct > tolerance ? flaggedMarkers : unflaggedMarkers).push(marker);
    }
    assert.ok(flaggedMarkers.length > 0, 'sanity: the fixture must produce at least one flagged marker');
    assert.ok(unflaggedMarkers.length > 0, 'sanity: the fixture must produce at least one unflagged marker');

    for (const marker of flaggedMarkers) {
      const row = findMarkerRow(result.stdout, marker);
      assert.ok(row, marker + ' table row must be present; got:\n' + result.stdout);
      assert.ok(row.trimStart().startsWith('* '),
        'flagged marker ' + marker + ' must be marked; got row: ' + JSON.stringify(row));
    }
    for (const marker of unflaggedMarkers) {
      const row = findMarkerRow(result.stdout, marker);
      assert.ok(row, marker + ' table row must be present; got:\n' + result.stdout);
      assert.ok(!row.trimStart().startsWith('* '),
        'unflagged marker ' + marker + ' must not be marked; got row: ' + JSON.stringify(row));
    }
  } finally {
    cleanupClone(dir);
  }
});

test('--explain (text): the tolerance value the flagged marks are measured against is stated once, in the header', () => {
  const dir = buildSyntheticExplainBook();
  try {
    const result = run(['--all', '--explain'], dir);
    assert.strictEqual(result.status, 1, 'stderr: ' + result.stderr);
    assert.ok(result.stdout.includes('2.00%'),
      'text output must state the 2.00% per-marker tolerance band somewhere (this fixture\'s ' +
      'configured stylometry_marker_tolerance); got:\n' + result.stdout);
  } finally {
    cleanupClone(dir);
  }
});

test('--explain --json: explain block carries markerTolerance, matching every marker\'s flagged boolean', () => {
  const dir = buildSyntheticExplainBook();
  try {
    const result = run(['--all', '--json', '--explain'], dir);
    assert.strictEqual(result.status, 1, 'stderr: ' + result.stderr);
    const out = JSON.parse(result.stdout);

    assert.strictEqual(out.explain.markerTolerance, 2,
      'explain.markerTolerance must equal this fixture\'s configured stylometry_marker_tolerance (2.0)');

    for (const m of out.explain.perMarker) {
      const shouldBeFlagged = m.deviationPct > out.explain.markerTolerance;
      assert.strictEqual(m.flagged, shouldBeFlagged,
        m.marker + ': flagged (' + m.flagged + ') must agree with deviationPct (' + m.deviationPct +
        ') compared against markerTolerance (' + out.explain.markerTolerance + ')');
    }
  } finally {
    cleanupClone(dir);
  }
});

test('--explain (text): determinism still holds after the flagged-signal fix (byte-identical across two runs)', () => {
  const dir = buildSyntheticExplainBook();
  try {
    const result1 = run(['--all', '--explain'], dir);
    assert.strictEqual(result1.status, 1, 'stderr: ' + result1.stderr);
    assert.ok(result1.stdout.includes('*'), 'sanity: this fixture must produce at least one flagged row');

    const result2 = run(['--all', '--explain'], dir);
    assert.strictEqual(result2.status, 1, 'stderr: ' + result2.stderr);

    assert.strictEqual(result1.stdout, result2.stdout,
      'explain text output must still be byte-identical across two runs after the flagged-signal fix');
  } finally {
    cleanupClone(dir);
  }
});
