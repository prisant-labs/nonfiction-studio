// tests/lib/bible.test.mjs
// what-it-is:   unit tests for hooks/lib/bible.mjs
// what-it-does: verifies findBookRoot, readProgress, and writeProgressAtomic behavior
// runner:       node --test tests/lib/bible.test.mjs (or node --test tests/lib/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import {
  BibleError,
  findBookRoot,
  readProgress,
  writeProgressAtomic,
} from '../../hooks/lib/bible.mjs';

// Absolute path to the golden sample book (used read-only).
const SAMPLE_BOOK = join(__dirname, '..', '..', 'examples', 'sample-book');

// ---- findBookRoot: success on direct book root ---------------------------------

test('findBookRoot returns {root, meta, config} when startDir is the book root itself', () => {
  const result = findBookRoot(SAMPLE_BOOK);
  assert.ok(result, 'result is truthy');
  assert.equal(result.root, SAMPLE_BOOK, 'root equals the sample book path');
  assert.ok(result.meta, 'meta is present');
  assert.ok(typeof result.meta === 'object', 'meta is an object');
  assert.equal(result.meta.schema_version, '2', 'meta.schema_version is 2');
  assert.ok(result.config, 'config is present');
  assert.ok(typeof result.config === 'object', 'config is an object');
});

// ---- findBookRoot: success walking up from a subdirectory ----------------------

test('findBookRoot walks up from chapters/ subdirectory and finds the book root', () => {
  const subdir = join(SAMPLE_BOOK, 'chapters');
  const result = findBookRoot(subdir);
  assert.equal(result.root, SAMPLE_BOOK, 'root equals the sample book even when starting in chapters/');
});

test('findBookRoot walks up from a context/ subdirectory and finds the book root', () => {
  const subdir = join(SAMPLE_BOOK, 'context');
  const result = findBookRoot(subdir);
  assert.equal(result.root, SAMPLE_BOOK, 'root equals the sample book even when starting in context/');
});

// ---- findBookRoot: typed error on non-book directory ---------------------------

test('findBookRoot throws BibleError with exitCode 2 on a non-book directory', () => {
  const notABook = join(__dirname, '..', '..', 'scripts');
  assert.throws(
    () => findBookRoot(notABook),
    (err) => {
      assert.ok(err instanceof BibleError, 'error is a BibleError');
      assert.equal(err.exitCode, 2, 'exitCode is 2');
      assert.equal(err.code, 'NO_BOOK_ROOT', 'code is NO_BOOK_ROOT');
      return true;
    },
    'findBookRoot on scripts/ throws BibleError'
  );
});

test('findBookRoot throws BibleError with exitCode 2 on a temp directory with no book', () => {
  const emptyDir = join(tmpdir(), 'nonfiction-test-no-book-' + Date.now());
  mkdirSync(emptyDir, { recursive: true });
  try {
    assert.throws(
      () => findBookRoot(emptyDir),
      (err) => {
        assert.ok(err instanceof BibleError, 'error is a BibleError');
        assert.equal(err.exitCode, 2, 'exitCode is 2');
        return true;
      },
      'findBookRoot on an empty temp dir throws BibleError'
    );
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

// ---- findBookRoot: book/ subdirectory layout -----------------------------------

test('findBookRoot detects the book/ subdirectory layout', () => {
  const workspace = join(tmpdir(), 'nonfiction-test-book-sub-' + Date.now());
  const bookRoot = join(workspace, 'book');
  mkdirSync(join(bookRoot, '.studio'), { recursive: true });
  mkdirSync(join(bookRoot, 'context'), { recursive: true });
  mkdirSync(join(bookRoot, 'chapters'), { recursive: true });

  const meta = { schema_version: '2', book_title: 'Test Book' };
  writeFileSync(join(bookRoot, '.studio', 'meta.json'), JSON.stringify(meta), 'utf8');

  try {
    const result = findBookRoot(workspace);
    assert.equal(result.root, bookRoot, 'root points at book/ subdirectory');
    assert.equal(result.meta.book_title, 'Test Book', 'meta is loaded correctly');
    assert.equal(result.config, null, 'config is null when config.json is absent');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

// ---- readProgress --------------------------------------------------------------

test('readProgress returns the parsed progress object from the sample book', () => {
  const progress = readProgress(SAMPLE_BOOK);
  assert.ok(progress, 'progress is truthy');
  assert.equal(progress.version, 2, 'version is 2');
  assert.ok(Array.isArray(progress.chapters), 'chapters is an array');
});

test('readProgress throws BibleError with exitCode 2 when progress.json is missing', () => {
  const workspace = join(tmpdir(), 'nonfiction-test-progress-' + Date.now());
  mkdirSync(join(workspace, '.studio'), { recursive: true });
  try {
    assert.throws(
      () => readProgress(workspace),
      (err) => {
        assert.ok(err instanceof BibleError, 'error is a BibleError');
        assert.equal(err.exitCode, 2, 'exitCode is 2');
        assert.equal(err.code, 'PROGRESS_READ_ERROR', 'code is PROGRESS_READ_ERROR');
        return true;
      }
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

// ---- writeProgressAtomic -------------------------------------------------------

test('writeProgressAtomic writes the file and leaves no .tmp file on success', () => {
  const workspace = join(tmpdir(), 'nonfiction-test-write-' + Date.now());
  mkdirSync(join(workspace, '.studio'), { recursive: true });
  const tmpPath = join(workspace, '.studio', 'progress.tmp.json');
  const progressPath = join(workspace, '.studio', 'progress.json');

  const data = { version: 2, updated: '2026-07-18T00:00:00Z', chapters: [], totals: {} };
  writeProgressAtomic(workspace, data);

  assert.ok(existsSync(progressPath), 'progress.json was written');
  assert.ok(!existsSync(tmpPath), 'no .tmp file remains after successful write');

  // Verify the written content can be read back.
  const read = readProgress(workspace);
  assert.equal(read.version, 2, 'version round-trips correctly');

  rmSync(workspace, { recursive: true, force: true });
});

test('writeProgressAtomic preserves unknown fields via read-modify-write', () => {
  const workspace = join(tmpdir(), 'nonfiction-test-rmw-' + Date.now());
  mkdirSync(join(workspace, '.studio'), { recursive: true });

  // Write an initial object with an unknown field.
  const initial = { version: 2, unknown_extra: 'preserved', chapters: [] };
  writeFileSync(
    join(workspace, '.studio', 'progress.json'),
    JSON.stringify(initial) + '\n',
    'utf8'
  );

  // Merge a partial update.
  writeProgressAtomic(workspace, { updated: '2026-07-18T00:00:00Z' });

  const result = readProgress(workspace);
  assert.equal(result.unknown_extra, 'preserved', 'unknown field is preserved after merge');
  assert.equal(result.updated, '2026-07-18T00:00:00Z', 'new field is written');
  assert.equal(result.version, 2, 'existing known field is preserved');

  rmSync(workspace, { recursive: true, force: true });
});

// ---- BibleError properties -----------------------------------------------------

test('BibleError has name, code, and exitCode 2', () => {
  const err = new BibleError('test message', 'TEST_CODE');
  assert.equal(err.name, 'BibleError');
  assert.equal(err.code, 'TEST_CODE');
  assert.equal(err.exitCode, 2);
  assert.ok(err instanceof Error);
  assert.ok(err instanceof BibleError);
});
