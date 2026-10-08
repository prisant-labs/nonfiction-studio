// tests/lib/chapters-dir.test.mjs
// what-it-is:   unit tests for the chapters-folder resolver and the amended book-root detection
//               in hooks/lib/bible.mjs, per ADR-0016 (adopting an existing book)
// what-it-does: verifies the pointer's chapters_dir key (name rule, reserved names, defaults),
//               chaptersDirNameOf / chaptersDirOf, and that a pointer naming a chapters folder
//               makes its directory a book root without context/, while ADR-0015's behavior holds
//               for every other layout
// runner:       node --test tests/lib/chapters-dir.test.mjs (or node --test tests/lib/)
//
// bible.mjs is imported as a namespace on purpose: a function that does not exist yet fails
// each test on its own ("is not a function") instead of failing the whole file at import time.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import * as bible from '../../hooks/lib/bible.mjs';
import { makeBook, makeTmpDir, writePointer } from './state-folder-books.mjs';
import { adoptFixture, copyFixture, FIXTURE_CHAPTERS_DIR } from './adopted-books.mjs';

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
const track = (root) => {
  made.push(dirname(root));
  return root;
};

function assertBibleError(fn, code, label) {
  let caught = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, label + ': expected a BibleError, got none');
  assert.equal(caught.code, code, label + ': ' + caught.message);
  return caught;
}

// ---- the chapters_dir name rule -------------------------------------------------------------

test('chapters_dir follows the state-folder name rule', () => {
  for (const good of ['chapters', 'manuscript', 'Drafts_2', 'part.one']) {
    assert.equal(bible.validateChaptersDirName(good, '_nonfiction-studio', 'linux'), null, good);
  }
  for (const bad of ['', '.', '..', 'a/b', 'a b', 'x'.repeat(65), 7, null]) {
    assert.equal(typeof bible.validateChaptersDirName(bad, '_nonfiction-studio', 'linux'), 'string', String(bad));
  }
});

test('chapters_dir may not name the state folder or a reserved folder [security: each would widen the drafting agents\' scope]', () => {
  for (const reserved of ['context', 'structure', 'research', 'production', '.git', '.claude']) {
    assert.match(bible.validateChaptersDirName(reserved, '_nonfiction-studio', 'linux'), /reserved/, reserved);
  }
  assert.match(bible.validateChaptersDirName('records', 'records', 'linux'), /state folder/);
  assert.match(bible.validateChaptersDirName('_nonfiction-studio', '_nonfiction-studio', 'linux'), /state folder/);
});

test('reserved chapters_dir names are compared without regard to case on win32 only', () => {
  assert.equal(typeof bible.validateChaptersDirName('Research', '_nonfiction-studio', 'win32'), 'string');
  assert.equal(typeof bible.validateChaptersDirName('RECORDS', 'records', 'win32'), 'string');
  assert.equal(bible.validateChaptersDirName('Research', '_nonfiction-studio', 'linux'), null);
});

// ---- the resolver ---------------------------------------------------------------------------

test('without a pointer the chapters folder is chapters', () => {
  const root = makeBook({ label: 'cd-default', stateDir: bible.DEFAULT_STATE_DIR });
  assert.equal(bible.DEFAULT_CHAPTERS_DIR, 'chapters');
  assert.equal(bible.chaptersDirNameOf(root), 'chapters');
  assert.equal(bible.chaptersDirOf(root), join(root, 'chapters'));
});

test('a pointer without chapters_dir keeps the default chapters folder', () => {
  const root = makeBook({ label: 'cd-state-only', stateDir: 'records', pointer: { state_dir: 'records' } });
  assert.equal(bible.chaptersDirNameOf(root), 'chapters');
});

test('a pointer with only chapters_dir names the chapters folder and keeps the default state folder', () => {
  const root = track(adoptFixture('cd-chapters-only'));
  assert.equal(bible.chaptersDirNameOf(root), FIXTURE_CHAPTERS_DIR);
  assert.equal(bible.chaptersDirOf(root), join(root, FIXTURE_CHAPTERS_DIR));
  assert.equal(bible.stateDirNameOf(root), bible.DEFAULT_STATE_DIR);
});

test('a pointer may name both folders', () => {
  const root = track(adoptFixture('cd-both', { stateDir: 'records' }));
  assert.equal(bible.chaptersDirNameOf(root), FIXTURE_CHAPTERS_DIR);
  assert.equal(bible.stateDirNameOf(root), 'records');
});

test('a pointer with neither key is a bad pointer', () => {
  const root = makeBook({ label: 'cd-empty-pointer', stateDir: bible.DEFAULT_STATE_DIR, pointer: {} });
  assertBibleError(() => bible.stateDirNameOf(root), 'STATE_POINTER_INVALID', 'stateDirNameOf');
  assertBibleError(() => bible.chaptersDirNameOf(root), 'STATE_POINTER_INVALID', 'chaptersDirNameOf');
});

test('a bad chapters_dir is a bad pointer for both resolvers and never falls back to chapters', () => {
  const root = makeBook({ label: 'cd-bad', stateDir: bible.DEFAULT_STATE_DIR, pointer: { chapters_dir: 'research' } });
  const err = assertBibleError(() => bible.chaptersDirNameOf(root), 'STATE_POINTER_INVALID', 'chaptersDirNameOf');
  assert.match(err.message, /chapters_dir/);
  assertBibleError(() => bible.stateDirNameOf(root), 'STATE_POINTER_INVALID', 'stateDirNameOf');
});

// ---- book-root detection (ADR-0016 amends ADR-0015) -----------------------------------------

test('a pointer naming a chapters folder makes its directory a book root without context/', () => {
  const root = track(adoptFixture('cd-root'));
  const found = bible.findBookRoot(join(root, FIXTURE_CHAPTERS_DIR));
  assert.equal(found.root, root);
  assert.equal(found.chaptersDirName, FIXTURE_CHAPTERS_DIR);
  assert.equal(found.chaptersDir, join(root, FIXTURE_CHAPTERS_DIR));
  assert.equal(found.stateDirName, bible.DEFAULT_STATE_DIR);
  assert.equal(found.meta.book_title, 'Counting What Matters');
});

test('findBookRoot reports the default chapters folder for a plugin-created book', () => {
  const root = makeBook({ label: 'cd-plugin-book', stateDir: bible.DEFAULT_STATE_DIR });
  const found = bible.findBookRoot(root);
  assert.equal(found.chaptersDirName, 'chapters');
  assert.equal(found.chaptersDir, join(root, 'chapters'));
});

test('a pointer naming a chapters folder that does not exist is a bad pointer, not an ignored file', () => {
  const root = track(adoptFixture('cd-missing-folder', { pointer: { chapters_dir: 'drafts' } }));
  const err = assertBibleError(() => bible.findBookRoot(root), 'STATE_POINTER_INVALID', 'missing chapters folder');
  assert.match(err.message, /drafts/);
  assert.equal(err.root, root);
});

test('a pointer naming a chapters folder over a missing state folder is a bad pointer', () => {
  const root = track(copyFixture('cd-no-state'));
  writePointer(root, { chapters_dir: FIXTURE_CHAPTERS_DIR });
  assertBibleError(() => bible.findBookRoot(root), 'STATE_POINTER_INVALID', 'no state folder');
});

test('a malformed pointer beside a state folder is a bad pointer: a broken adoption is reported', () => {
  const root = track(adoptFixture('cd-broken'));
  writeFileSync(join(root, bible.POINTER_FILE), '{ "chapters_dir": ');
  assertBibleError(() => bible.findBookRoot(root), 'STATE_POINTER_INVALID', 'broken adoption');
});

test('a stray malformed pointer with no state folder is still ignored (ADR-0015 pin)', () => {
  const dir = makeTmpDir('cd-stray');
  writePointer(dir, 'not valid json {{');
  assertBibleError(() => bible.findBookRoot(dir), 'NO_BOOK_ROOT', 'a stray pointer is not a book');
});

test('a stray pointer that names no chapters folder is ignored outside a book', () => {
  const dir = makeTmpDir('cd-stray-state');
  writePointer(dir, { state_dir: 'records' });
  mkdirSync(join(dir, 'records'));
  assertBibleError(() => bible.findBookRoot(dir), 'NO_BOOK_ROOT', 'ADR-0015 behavior is unchanged');
});

test('a foreign book before adoption is not a book root', () => {
  const root = track(copyFixture('cd-pre'));
  assertBibleError(() => bible.findBookRoot(root), 'NO_BOOK_ROOT', 'pre-adoption');
});
