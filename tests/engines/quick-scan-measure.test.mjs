// tests/engines/quick-scan-measure.test.mjs
// what-it-is:   dependency-proof test for the quick-scan skill's load-bearing mechanism
// what-it-does: proves that `ns-stylometry --measure=<path>` works end to end on a temp
//               file containing realistic PASTED PROSE (not a committed book chapter),
//               written to a path outside the repo and outside examples/, exactly the
//               shape of invocation OPP-D17 (five-minute first win)'s quick-scan skill
//               depends on: write pasted text to a temp file, measure it, present the
//               named markers. Also proves the boundary data (totalWords) quick-scan
//               reads to decide which word-count band applies is accurate at three
//               sizes: under 500, the 500-1000 target band, and well over 1000.
// why:          task-6 brief, Testing section: "The --measure invocation path works on a
//               temp file containing pasted prose and returns named markers. This is the
//               load-bearing mechanism of quick-scan, and it should not be assumed."
//               bin/ns-stylometry and hooks/lib/stylometry-engine.mjs are unmodified by
//               this task (out of scope per the task-6 brief); this suite is therefore a
//               characterization/regression proof of pre-existing, unmodified engine
//               behavior against a NEW input shape (pasted prose, arbitrary temp path),
//               not a red-then-green test of new production code. It passed on first run
//               because the --measure mode (TSK-037) already generalizes to any readable
//               text file; the point of this suite is to make that fact verified rather
//               than assumed, per the brief's own instruction.
// runner:       node --test tests/engines/quick-scan-measure.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { countWords } from '../../hooks/lib/stylometry-engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const BIN = join(REPO_ROOT, 'bin', 'ns-stylometry');
const FIXTURE = join(__dirname, 'fixtures', 'quick-scan', 'pasted-prose-sample.md');
const EIGHT_MARKERS = [
  'function_word_rate', 'contraction_rate', 'first_person_rate',
  'second_person_rate', 'type_token_ratio', 'avg_word_length',
  'avg_sentence_length', 'punctuation_rate',
];

function runMeasure(paths) {
  return spawnSync(process.execPath, [BIN, '--measure=' + paths], { encoding: 'utf8' });
}

// ---------------------------------------------------------------------------
// The exact mechanism quick-scan's SKILL.md instructs: write pasted prose to
// a temp file OUTSIDE the repo and outside examples/, then --measure it.
// ---------------------------------------------------------------------------

test('quick-scan mechanism: pasted prose written to an os.tmpdir() file measures cleanly', () => {
  const pastedText = readFileSync(FIXTURE, 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'ns-quick-scan-test-'));
  const tmpFile = join(dir, 'nonfiction-studio-quick-scan.md');
  writeFileSync(tmpFile, pastedText, 'utf8');

  try {
    // The temp file must resolve outside the repo checkout and outside
    // examples/ specifically -- the brief's explicit constraint.
    assert.ok(
      !resolve(tmpFile).startsWith(REPO_ROOT + sep),
      'temp file must not resolve inside the repo checkout'
    );

    const result = runMeasure(tmpFile);
    assert.strictEqual(result.status, 0, '--measure exits 0 on pasted prose; stderr: ' + result.stderr);

    const out = JSON.parse(result.stdout);
    assert.deepStrictEqual(
      Object.keys(out.markers).sort(), [...EIGHT_MARKERS].sort(),
      'measure output carries exactly the eight named markers quick-scan presents by name'
    );
    for (const key of EIGHT_MARKERS) {
      assert.ok(typeof out.markers[key] === 'number' && isFinite(out.markers[key]), key + ' is a finite number');
    }

    // totalWords is the exact figure quick-scan uses to decide which
    // word-count band (under 500 / 500-1000 / well over 1000) applies.
    const expectedWords = countWords(pastedText);
    assert.strictEqual(out.totalWords, expectedWords, 'totalWords matches the engine tokenizer exactly');
    assert.ok(
      out.totalWords >= 500 && out.totalWords <= 1000,
      'fixture sample is inside the 500-1000 target band; got ' + out.totalWords
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quick-scan mechanism: markers key set matches the golden config baseline vocabulary', () => {
  // Quick-scan presents marker names the author may later see again in
  // capture-voice's baseline (context/style-profile.md / config.json). The
  // vocabulary must be the same set both places.
  const pastedText = readFileSync(FIXTURE, 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'ns-quick-scan-test-'));
  const tmpFile = join(dir, 'sample.md');
  writeFileSync(tmpFile, pastedText, 'utf8');

  try {
    const result = runMeasure(tmpFile);
    assert.strictEqual(result.status, 0, 'stderr: ' + result.stderr);
    const out = JSON.parse(result.stdout);

    const config = JSON.parse(readFileSync(
      join(REPO_ROOT, 'examples', 'sample-book', '.studio', 'config.json'), 'utf8'
    ));
    const goldenKeys = Object.keys(config.stylometry.baseline.markers).sort();
    assert.deepStrictEqual(Object.keys(out.markers).sort(), goldenKeys,
      'quick-scan marker names must equal the same vocabulary capture-voice uses');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quick-scan mechanism: two runs of the same pasted text are deterministic', () => {
  // Reinforces the honesty line the brief draws: this is a measurement, not
  // a model improvisation, so it must be perfectly reproducible.
  const pastedText = readFileSync(FIXTURE, 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'ns-quick-scan-test-'));
  const tmpFile = join(dir, 'sample.md');
  writeFileSync(tmpFile, pastedText, 'utf8');

  try {
    const first = runMeasure(tmpFile);
    const second = runMeasure(tmpFile);
    assert.strictEqual(first.status, 0);
    assert.strictEqual(second.status, 0);
    assert.deepStrictEqual(JSON.parse(first.stdout), JSON.parse(second.stdout),
      'identical input must produce byte-identical marker output');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Word-count boundary data: under 500 / well over 1000 -- the two edge bands
// quick-scan's SKILL.md must handle honestly (noisy-at-short, say-what-was-
// measured-at-long).
// ---------------------------------------------------------------------------

test('boundary: a short (< 500 word) excerpt still measures, with an accurate low totalWords', () => {
  const fullText = readFileSync(FIXTURE, 'utf8');
  const shortText = fullText.split(/\s+/).slice(0, 120).join(' '); // ~120 words: under the 500 floor
  const dir = mkdtempSync(join(tmpdir(), 'ns-quick-scan-test-'));
  const tmpFile = join(dir, 'short.md');
  writeFileSync(tmpFile, shortText, 'utf8');

  try {
    const result = runMeasure(tmpFile);
    assert.strictEqual(result.status, 0, 'short pasted text still exits 0; stderr: ' + result.stderr);
    const out = JSON.parse(result.stdout);
    assert.ok(out.totalWords < 500, 'totalWords must read as under the 500-word floor; got ' + out.totalWords);
    assert.ok(out.totalWords > 0, 'totalWords must be positive for non-empty text');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('boundary: a long (well over 1000 word) paste measures the full text without truncation', () => {
  const fullText = readFileSync(FIXTURE, 'utf8');
  // Repeat the fixture to comfortably clear 1000 words without fabricating new prose.
  const longText = (fullText + '\n\n' + fullText + '\n\n' + fullText).trim();
  const dir = mkdtempSync(join(tmpdir(), 'ns-quick-scan-test-'));
  const tmpFile = join(dir, 'long.md');
  writeFileSync(tmpFile, longText, 'utf8');

  try {
    const result = runMeasure(tmpFile);
    assert.strictEqual(result.status, 0, 'long pasted text still exits 0; stderr: ' + result.stderr);
    const out = JSON.parse(result.stdout);
    assert.ok(out.totalWords > 1000, 'totalWords must read as well over 1000; got ' + out.totalWords);
    // Not truncated: the tripled text measures at (approximately) 3x the single-copy count.
    const singleCount = countWords(fullText);
    assert.strictEqual(out.totalWords, singleCount * 3,
      'the full pasted text is measured, not truncated to some fixed window');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mechanism: the CLI writes nothing to the temp directory (measure mode is read-only)', () => {
  const pastedText = readFileSync(FIXTURE, 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'ns-quick-scan-test-'));
  const tmpFile = join(dir, 'sample.md');
  writeFileSync(tmpFile, pastedText, 'utf8');

  try {
    const before = readdirSync(dir).sort();
    const result = runMeasure(tmpFile);
    assert.strictEqual(result.status, 0);
    const after = readdirSync(dir).sort();
    assert.deepStrictEqual(after, before, 'no files created or removed by the measure invocation');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
