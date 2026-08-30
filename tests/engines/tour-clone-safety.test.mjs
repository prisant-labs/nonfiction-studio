// tests/engines/tour-clone-safety.test.mjs
// what-it-is:   safety proof for the nfs-tour skill's copy-before-demonstrate procedure
// what-it-does: (1) proves the content-hash snapshot/diff helper this suite defines
//               correctly DETECTS a write into a source tree, using a disposable
//               synthetic fixture (never examples/); this is the suite's real
//               red-then-green target, since the helper is new code written for this
//               suite; (2) proves the nfs-tour's actual documented procedure: clone
//               examples/sample-book to a fresh temp directory with fs.cpSync, then
//               edit the gate mode, plant a defect, and revert it, all inside the
//               clone only, leaves the real, committed examples/sample-book tree
//               byte-for-byte unmodified. Mirrors the content-hash technique in
//               scripts/test-fixtures.mjs's own temp-clone pattern.
// why:          OPP-D17 (five-minute first win): the nfs-tour skill copies examples/sample-book
//               to a disposable location and plants a defect there, so the copy step itself
//               needs a proof that it never writes into the source tree, since a direct write
//               into a shipped example is a realistic mistake for any tour-like procedure to
//               make and would corrupt the shipped example for every later user. It never
//               writes into examples/sample-book at any point, including during its own
//               development: diffSnapshots was deliberately run first against a stubbed,
//               broken implementation (a stub returning an empty array unconditionally),
//               which correctly failed to detect a planted change in a disposable synthetic
//               fixture, before the real implementation below was restored and re-verified.
//               That RED-then-GREEN cycle was recorded at implementation time and never
//               touched the real examples/ tree.
// runner:       node --test tests/engines/tour-clone-safety.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');

// ---------------------------------------------------------------------------
// snapshotDir / diffSnapshots: content-hash snapshot helpers, generalized
// from scripts/test-fixtures.mjs's inline snapshotExamples() to take an
// arbitrary root so this suite can exercise them safely against a synthetic
// fixture before ever pointing them at the real examples/ tree.
// ---------------------------------------------------------------------------

function snapshotDir(root) {
  const map = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = relative(root, abs).split('\\').join('/');
      map.set(rel, createHash('sha256').update(readFileSync(abs)).digest('hex'));
    }
  };
  walk(root);
  return map;
}

/**
 * Returns a list of human-readable residue descriptions: any path created,
 * modified, or deleted between two snapshotDir() results. Empty means the
 * tree is unchanged.
 */
function diffSnapshots(before, after) {
  const residue = [];
  for (const [path, hash] of after) {
    const priorHash = before.get(path);
    if (priorHash === undefined) residue.push('created: ' + path);
    else if (priorHash !== hash) residue.push('modified: ' + path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) residue.push('deleted: ' + path);
  }
  return residue;
}

// ---------------------------------------------------------------------------
// Part A: prove the detection helper itself works, entirely on a disposable
// synthetic fixture. This is the suite's genuine red-then-green target: a
// deliberately broken first draft of diffSnapshots (a stub returning an
// empty array unconditionally) failed the two "CATCHES" tests below for the
// correct reason, unable to detect the planted change, before the real
// implementation above replaced it and both tests passed.
// ---------------------------------------------------------------------------

test('detection sanity: diffSnapshots reports no residue when nothing changed', () => {
  const src = mkdtempSync(join(tmpdir(), 'ns-tour-safety-synth-'));
  writeFileSync(join(src, 'a.md'), 'original content\n', 'utf8');
  mkdirSync(join(src, 'sub'));
  writeFileSync(join(src, 'sub', 'b.md'), 'nested content\n', 'utf8');

  try {
    const before = snapshotDir(src);
    const after = snapshotDir(src); // nothing happened in between
    assert.deepStrictEqual(diffSnapshots(before, after), [], 'unchanged tree reports zero residue');
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
});

test('detection sanity: diffSnapshots CATCHES a write into the source tree (the exact mistake this test exists to prevent)', () => {
  const src = mkdtempSync(join(tmpdir(), 'ns-tour-safety-synth-'));
  writeFileSync(join(src, 'a.md'), 'original content\n', 'utf8');

  try {
    const before = snapshotDir(src);

    // Simulate the documented anti-pattern: an nfs-tour step that forgets to
    // clone first and writes directly into the source tree instead.
    writeFileSync(join(src, 'a.md'), 'original content\nPLANTED DEFECT\n', 'utf8');

    const after = snapshotDir(src);
    const residue = diffSnapshots(before, after);
    assert.deepStrictEqual(residue, ['modified: a.md'],
      'a direct write into the source tree must be reported as residue');
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
});

test('detection sanity: diffSnapshots CATCHES a new file created in the source tree', () => {
  const src = mkdtempSync(join(tmpdir(), 'ns-tour-safety-synth-'));
  writeFileSync(join(src, 'a.md'), 'original content\n', 'utf8');

  try {
    const before = snapshotDir(src);
    writeFileSync(join(src, 'gate-report.json'), '{"planted": true}\n', 'utf8');
    const after = snapshotDir(src);
    assert.deepStrictEqual(diffSnapshots(before, after), ['created: gate-report.json']);
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Part B: the real safety proof. Clone examples/sample-book with fs.cpSync
// (nfs-tour's documented mechanism) into a fresh temp directory, then run a
// representative version of nfs-tour's own procedure -- gate-mode edit,
// defect plant, revert -- entirely inside the clone. examples/sample-book
// itself is only ever READ in this test (once, for the before-snapshot, and
// implicitly as fs.cpSync's read-only source argument); it is never opened
// for writing at any point.
// ---------------------------------------------------------------------------

test('nfs-tour procedure: cloning + editing the clone leaves examples/sample-book byte-for-byte unmodified', () => {
  const beforeSampleBook = snapshotDir(SAMPLE_BOOK);

  const destParent = mkdtempSync(join(tmpdir(), 'ns-tour-safety-real-'));
  const tourDir = join(destParent, 'sample-book-tour');

  try {
    // Step 1 of nfs-tour: clone via fs.cpSync (never writes to its source).
    cpSync(SAMPLE_BOOK, tourDir, { recursive: true });

    const cloneRightAfterCopy = snapshotDir(tourDir);

    // Step 2: flip the CLONE's gate mode from warn to block (an edit
    // nfs-tour performs only inside the clone).
    const configPath = join(tourDir, '.studio', 'config.json');
    const configText = readFileSync(configPath, 'utf8');
    const blockedConfig = configText.replace('"mode": "warn",', '"mode": "block",');
    assert.notStrictEqual(blockedConfig, configText, 'the gate-mode replacement must actually match something');
    writeFileSync(configPath, blockedConfig, 'utf8');

    // Step 3: plant nfs-tour's defect (an AI self-reference line) in the CLONE only.
    const chapterPath = join(tourDir, 'chapters', '02-finding-your-network.md');
    const chapterText = readFileSync(chapterPath, 'utf8');
    const plantedText = chapterText + '\nHere is a draft of this paragraph for the author to revise.\n';
    writeFileSync(chapterPath, plantedText, 'utf8');

    // Step 4: fix -- revert the clone's chapter to its original content.
    writeFileSync(chapterPath, chapterText, 'utf8');

    // Sanity check: the clone really was touched (this is not a vacuous test).
    const cloneAfterRevert = snapshotDir(tourDir);
    const cloneResidue = diffSnapshots(cloneRightAfterCopy, cloneAfterRevert);
    assert.deepStrictEqual(cloneResidue, ['modified: .studio/config.json'],
      'inside the clone, only the gate-mode edit should remain after the plant-then-revert cycle; got: ' +
      JSON.stringify(cloneResidue));

    // The real assertion: examples/sample-book, the committed shipped
    // artifact, is completely unmodified by any of the above.
    const afterSampleBook = snapshotDir(SAMPLE_BOOK);
    const sourceResidue = diffSnapshots(beforeSampleBook, afterSampleBook);
    assert.deepStrictEqual(sourceResidue, [],
      'examples/sample-book must be byte-for-byte unmodified after the nfs-tour procedure; residue: ' +
      JSON.stringify(sourceResidue));
  } finally {
    rmSync(destParent, { recursive: true, force: true });
  }
});
