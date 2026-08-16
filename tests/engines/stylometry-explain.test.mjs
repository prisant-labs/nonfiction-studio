// tests/engines/stylometry-explain.test.mjs
// what-it-is:   CLI-level tests for `ns-stylometry --explain`
// what-it-does: proves the explain flag renders every marker (baseline, measured, honest
//               deviation, actual contribution, whether the per-marker bound was binding)
//               ordered by contribution descending; that a capped marker's stated deviation
//               exceeds its stated contribution and the output says so in words; that the
//               rendering is deterministic and locale-independent; that it writes nothing to
//               disk; that it composes with the existing text and --json modes without
//               changing the exit-code taxonomy; and that a JSON consumer who never passes
//               --explain sees byte-for-byte the same shape as before this flag existed.
// why:          the drift score was opaque -- a marker's honest deviation and its actual
//               (possibly capped) contribution could disagree with no way for an author to
//               see why. computeDrift already computed both; this flag surfaces them.
// fixtures:     every run below uses a TEMP CLONE of examples/sample-book or
//               examples/fixtures/voice-drift, never the committed tree in place (the
//               fixture suite in scripts/test-fixtures.mjs asserts examples/ stays byte-clean).
// runner:       node --test tests/engines/stylometry-explain.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, cpSync, rmSync, writeFileSync, readdirSync, statSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EXAMPLES = join(__dirname, '..', '..', 'examples');
const BIN = join(__dirname, '..', '..', 'bin', 'ns-stylometry');
const GOLDEN_SRC = join(EXAMPLES, 'sample-book');
const VOICE_DRIFT_SRC = join(EXAMPLES, 'fixtures', 'voice-drift');

// ---------------------------------------------------------------------------
// Scratch clone helpers (never run the CLI against examples/ in place)
// ---------------------------------------------------------------------------

function cloneFixture(sourceDir, label) {
  const prefix = 'ns-stylometry-explain-' + label + '-';
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cpSync(sourceDir, dir, { recursive: true });
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
// AC: a marker whose honest deviation exceeds its stated contribution, and the
// output says the bound was binding. The voice-drift fixture's first_person_rate
// is the committed, documented case (PLANTED.md): baseline 0.2262, measured 0,
// so deviationPct is exactly 100 by construction (not incidental), well past this
// fixture's per-marker bound (threshold 20 / 3 = 6.67).
// ---------------------------------------------------------------------------

test('--explain --json: a capped marker reports deviationPct greater than its own contribution, and capped is true', () => {
  const clone = cloneFixture(VOICE_DRIFT_SRC, 'capped-json');
  try {
    const result = run(['--all', '--json', '--explain'], clone);
    assert.strictEqual(result.status, 1,
      'voice-drift fixture must still exit 1 with --explain; stderr: ' + result.stderr);

    const out = JSON.parse(result.stdout);
    assert.ok(out.explain, 'JSON output must carry an explain block when --explain is passed');
    assert.ok(Array.isArray(out.explain.perMarker), 'explain.perMarker must be an array');

    const fp = out.explain.perMarker.find(m => m.marker === 'first_person_rate');
    assert.ok(fp, 'first_person_rate must be present in explain.perMarker');
    assert.strictEqual(fp.deviationPct, 100, 'first_person_rate honest deviation must be exactly 100 (baseline nonzero, measured 0)');
    assert.strictEqual(fp.capped, true, 'first_person_rate must be recorded as capped');
    assert.ok(fp.contribution < fp.deviationPct,
      'a capped marker\'s stated contribution must be less than its stated (honest) deviation; ' +
      'contribution=' + fp.contribution + ' deviation=' + fp.deviationPct);
    assert.strictEqual(fp.contribution, out.explain.maxMarkerContribution,
      'a capped marker\'s contribution must equal the reported per-marker bound exactly');
  } finally {
    cleanupClone(clone);
  }
});

test('--explain (text): the output says the bound was binding, in words, for the same capped marker', () => {
  const clone = cloneFixture(VOICE_DRIFT_SRC, 'capped-text');
  try {
    const result = run(['--all', '--explain'], clone);
    assert.strictEqual(result.status, 1,
      'voice-drift fixture must still exit 1 with --explain; stderr: ' + result.stderr);

    assert.ok(result.stdout.includes('first_person_rate'),
      'text output must name first_person_rate; got:\n' + result.stdout);
    assert.ok(result.stdout.includes('bound was binding'),
      'text output must say in words that the bound was binding somewhere; got:\n' + result.stdout);
    assert.ok(result.stdout.includes('100.00'),
      'text output must show the honest (uncapped) deviation 100.00 for first_person_rate; got:\n' + result.stdout);
  } finally {
    cleanupClone(clone);
  }
});

// ---------------------------------------------------------------------------
// AC: every marker rendered, ordered by contribution descending
// ---------------------------------------------------------------------------

test('--explain --json: explain.perMarker covers all 8 markers with the required fields, ordered by contribution descending', () => {
  const clone = cloneFixture(VOICE_DRIFT_SRC, 'ordering');
  try {
    const result = run(['--all', '--json', '--explain'], clone);
    assert.strictEqual(result.status, 1, 'stderr: ' + result.stderr);

    const out = JSON.parse(result.stdout);
    const list = out.explain.perMarker;
    assert.strictEqual(list.length, 8, 'explain.perMarker must cover all 8 markers; got ' + list.length);

    for (const m of list) {
      assert.strictEqual(typeof m.marker, 'string', 'marker name must be a string');
      assert.strictEqual(typeof m.baseline, 'number', m.marker + ': baseline must be a number');
      assert.strictEqual(typeof m.measured, 'number', m.marker + ': measured must be a number');
      assert.strictEqual(typeof m.deviationPct, 'number', m.marker + ': deviationPct must be a number');
      assert.strictEqual(typeof m.contribution, 'number', m.marker + ': contribution must be a number');
      assert.strictEqual(typeof m.capped, 'boolean', m.marker + ': capped must be a boolean');
    }

    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i - 1].contribution >= list[i].contribution,
        'explain.perMarker must be ordered by contribution descending; position ' + (i - 1) +
        ' (' + list[i - 1].marker + '=' + list[i - 1].contribution + ') is less than position ' +
        i + ' (' + list[i].marker + '=' + list[i].contribution + ')');
    }
  } finally {
    cleanupClone(clone);
  }
});

// ---------------------------------------------------------------------------
// AC: deterministic and locale-independent -- run twice, compare bytes.
// Text mode only (no --json): the JSON envelope carries a `ts` timestamp that
// legitimately differs between two real invocations, so byte-comparing full
// JSON output would not test what this criterion means. Text mode carries no
// timestamp, matching the convention hooks/lib/statusline-engine.mjs already
// uses for its own deterministic output.
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

test('exit code is identical with and without --explain: golden book (pass)', () => {
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

test('exit code is identical with and without --explain: voice-drift fixture (block)', () => {
  const clone = cloneFixture(VOICE_DRIFT_SRC, 'parity-block');
  try {
    const without = run(['--all'], clone);
    const withExplain = run(['--all', '--explain'], clone);
    assert.strictEqual(without.status, 1, 'stderr: ' + without.stderr);
    assert.strictEqual(withExplain.status, without.status,
      '--explain must not change the exit code; without=' + without.status + ' with=' + withExplain.status +
      '; stderr: ' + withExplain.stderr);
  } finally {
    cleanupClone(clone);
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
    assert.ok(without.stderr.includes('capture-voice'),
      'stale-baseline error must name capture-voice as the remedy; stderr: ' + without.stderr);

    assert.strictEqual(withExplain.status, 2,
      '--explain must not change the exit code on the operational-error path; stderr: ' + withExplain.stderr);
    assert.ok(withExplain.stderr.includes('capture-voice'),
      '--explain must reach the same stale-baseline error, not a different one; stderr: ' + withExplain.stderr);

    assert.strictEqual(withExplain.stderr, without.stderr,
      '--explain must not alter the operational-error message at all');
  } finally {
    cleanupClone(clone);
  }
});

// ---------------------------------------------------------------------------
// Judgment call: what --explain does when there is no meaningful score to
// explain (zero chapters). Chosen: a stated reason, not silence, matching how
// this CLI already behaves for the same zero-chapter case without --explain.
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
// Backward compatibility: a consumer of the existing --json output who never
// passes --explain must see byte-for-byte the same shape as before this flag
// existed. This is a standing invariant, not a red/green feature test: it is
// expected to hold both before and after this change.
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
