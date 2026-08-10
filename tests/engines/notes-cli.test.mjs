// tests/engines/notes-cli.test.mjs
// what-it-is:   CLI-level tests for bin/ns-notes
// what-it-does: spawns the real bin/ns-notes binary against temp clones of the committed golden
//               sample book (never the committed tree itself) to prove: exit-code mapping against
//               real data, byte-identical regeneration at the file level (both a same-run-twice
//               proof and a proof against the committed examples/sample-book/production/ output),
//               that nothing is written under .studio/, that a source cited only through a
//               blank-locator entry still reaches the bibliography, the clean (exit 0) path, and
//               CLI-level argument and operational-error handling
// runner:       node --test tests/engines/notes-cli.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, writeFileSync, mkdirSync, cpSync, mkdtempSync, rmSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = join(__dirname, '..', '..');
const EXAMPLES = join(REPO_ROOT, 'examples');
const BIN = join(REPO_ROOT, 'bin', 'ns-notes');
const GOLDEN = join(EXAMPLES, 'sample-book');
const COMMITTED_PRODUCTION = join(GOLDEN, 'production');

function makeTempClone(sourceDir) {
  const base = join(os.tmpdir(), 'ns-notes-cli-test');
  mkdirSync(base, { recursive: true });
  const tmpDir = mkdtempSync(base + '/clone-');
  cpSync(sourceDir, tmpDir, { recursive: true });
  return tmpDir;
}

function spawnNotes(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: process.env });
}

const OUTPUT_FILES = ['endnotes.md', 'bibliography.md', 'index-candidates.md', 'apparatus-attention.md'];

// ---- exit-code mapping against the real committed ledger ------------------------------

test('golden book: ns-notes writes all four production/ files and exits 1 (the real ledger has two blank locators)', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnNotes(tmp, ['--json']);
    assert.strictEqual(result.status, 1, 'stdout: ' + result.stdout + ' stderr: ' + result.stderr);

    for (const name of OUTPUT_FILES) {
      assert.ok(existsSync(join(tmp, 'production', name)), 'production/' + name + ' was written');
    }

    const json = JSON.parse(result.stdout);
    assert.strictEqual(json.check, 'apparatus');
    assert.strictEqual(json.verdict, 'block');
    assert.strictEqual(json.findings.length, 2, 'EV-0001 and EV-0005 both cite SRC-0003 with a blank locator');
    const ids = json.findings.map((f) => f.excerpt).sort();
    assert.deepStrictEqual(ids, ['EV-0001', 'EV-0005']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('golden book: human-readable output names the check and, on findings, each attention row', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnNotes(tmp, []);
    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /^\[apparatus\]/);
    assert.match(result.stdout, /EV-0001/);
    assert.match(result.stdout, /EV-0005/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- byte-identical regeneration (file level) ------------------------------------------

test('byte-identical regeneration: running twice over an unchanged clone produces identical files', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const first = spawnNotes(tmp, []);
    assert.strictEqual(first.status, 1, 'stderr: ' + first.stderr);
    const firstBytes = OUTPUT_FILES.map((f) => readFileSync(join(tmp, 'production', f)));

    const second = spawnNotes(tmp, []);
    assert.strictEqual(second.status, 1, 'stderr: ' + second.stderr);
    const secondBytes = OUTPUT_FILES.map((f) => readFileSync(join(tmp, 'production', f)));

    OUTPUT_FILES.forEach((f, i) => {
      assert.ok(firstBytes[i].equals(secondBytes[i]), 'production/' + f + ' is byte-identical across two runs');
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('regenerating the sample book reproduces the committed production/ files byte-for-byte', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnNotes(tmp, []);
    assert.strictEqual(result.status, 1, 'stderr: ' + result.stderr);

    for (const name of OUTPUT_FILES) {
      const generated = readFileSync(join(tmp, 'production', name));
      const committed = readFileSync(join(COMMITTED_PRODUCTION, name));
      assert.ok(
        generated.equals(committed),
        'examples/sample-book/production/' + name + ' matches freshly regenerated output byte-for-byte; ' +
        'if this fails, the committed file is stale -- regenerate it with ns-notes and re-commit'
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- D-06 (single-writer state discipline): .studio/ is never touched -----------------

test('.studio/ is never written', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const before = readFileSync(join(tmp, '.studio', 'config.json'), 'utf8');
    const result = spawnNotes(tmp, []);
    assert.strictEqual(result.status, 1, 'stderr: ' + result.stderr);
    const after = readFileSync(join(tmp, '.studio', 'config.json'), 'utf8');
    assert.strictEqual(before, after, '.studio/config.json is untouched');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- a source cited only through a blank-locator entry still reaches the bibliography --

test('a source cited only by blank-locator entries still appears in the bibliography (the citation is real; only the note is blocked)', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnNotes(tmp, []);
    assert.strictEqual(result.status, 1, 'stderr: ' + result.stderr);
    const bibliography = readFileSync(join(tmp, 'production', 'bibliography.md'), 'utf8');
    assert.match(bibliography, /Jarche, Harold/, 'SRC-0003 (cited only by EV-0001 and EV-0005, both blank-locator) still appears');

    const endnotes = readFileSync(join(tmp, 'production', 'endnotes.md'), 'utf8');
    assert.doesNotMatch(endnotes, /EV-0001/);
    assert.doesNotMatch(endnotes, /EV-0005/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- clean path: exit 0 with an empty attention list -----------------------------------

test('clean ledger: filling in the two blank locators makes ns-notes exit 0 with an empty attention list', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const ledgerPath = join(tmp, 'research', 'evidence-log.md');
    const fixed = readFileSync(ledgerPath, 'utf8')
      .replace('### EV-0001 (passive-consumption rate)\n- claim: Most online learners spend more than 80 percent of their digital learning time consuming content without taking any action on it.\n- source: SRC-0003\n- locator:\n',
        '### EV-0001 (passive-consumption rate)\n- claim: Most online learners spend more than 80 percent of their digital learning time consuming content without taking any action on it.\n- source: SRC-0003\n- locator: under "Seek"\n')
      .replace('### EV-0005 (pln compounding)\n- claim: A well-curated personal learning network produces a self-reinforcing loop where better inputs lead to better thinking, which over time attracts better connections.\n- source: SRC-0003\n- locator:\n',
        '### EV-0005 (pln compounding)\n- claim: A well-curated personal learning network produces a self-reinforcing loop where better inputs lead to better thinking, which over time attracts better connections.\n- source: SRC-0003\n- locator: under "Sense"\n');
    assert.notStrictEqual(fixed, readFileSync(ledgerPath, 'utf8'), 'the two targeted replacements must actually match the fixture text');
    writeFileSync(ledgerPath, fixed, 'utf8');

    const result = spawnNotes(tmp, ['--json']);
    assert.strictEqual(result.status, 0, 'stdout: ' + result.stdout + ' stderr: ' + result.stderr);
    const json = JSON.parse(result.stdout);
    assert.strictEqual(json.verdict, 'pass');
    assert.strictEqual(json.findings.length, 0);
    assert.strictEqual(json.totalNotes, 10, 'all ten EV entries now render a note');

    const endnotes = readFileSync(join(tmp, 'production', 'endnotes.md'), 'utf8');
    assert.match(endnotes, /under "Seek"/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- argument and operational errors ----------------------------------------------------

test('unknown flag: exits 2 with a named argument error', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnNotes(tmp, ['--bogus']);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /--bogus/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('no book root: exits 2 with a named error, writes nothing', () => {
  const base = join(os.tmpdir(), 'ns-notes-cli-test');
  mkdirSync(base, { recursive: true });
  const empty = mkdtempSync(base + '/empty-');
  try {
    const result = spawnNotes(empty, []);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /ns-notes/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
