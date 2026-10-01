// tests/lib/state-folder.test.mjs
// what-it-is:   unit tests for the configurable state folder in hooks/lib/bible.mjs (ADR-0015)
// what-it-does: pins the pointer file's parsing and validation, the never-fall-back rule for a
//               bad pointer, the unpointed-folder detector, both findBookRoot layouts, and the
//               research-librarian write scope that follows the resolved state folder
// runner:       node --test tests/lib/state-folder.test.mjs
//
// bible.mjs is imported as a namespace on purpose: a function that does not exist yet fails
// each test on its own ("is not a function") instead of failing the whole file at import time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import * as bible from '../../hooks/lib/bible.mjs';
import { checkAgentWriteConstraint } from '../../hooks/lib/agent-identity.mjs';
import {
  POINTER_FILE,
  makeTmpDir,
  makeBook,
  writeStateFolder,
  writePointer,
} from './state-folder-books.mjs';

function assertBibleError(fn, code, label) {
  let caught = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, label + ': expected a throw');
  assert.equal(caught.name, 'BibleError', label + ': error is a BibleError, got ' + (caught && caught.name));
  assert.equal(caught.code, code, label + ': error code; message was: ' + caught.message);
  return caught;
}

// ---- validateStateDirName ------------------------------------------------------------------

test('validateStateDirName accepts ordinary single-segment names', () => {
  for (const name of ['records', '_nonfiction-studio', '.studio', 'state.v2', 'a-b_c.d', 'x'.repeat(64)]) {
    assert.equal(bible.validateStateDirName(name, 'linux'), null, JSON.stringify(name) + ' is valid');
  }
});

test('validateStateDirName rejects empty, dot, dot-dot, separators, and characters outside the set', () => {
  const bad = ['', '.', '..', 'a/b', 'a\\b', '../escape', 'with space', 'récords', 'C:', 'star*', 'x'.repeat(65)];
  for (const name of bad) {
    assert.equal(typeof bible.validateStateDirName(name, 'linux'), 'string', JSON.stringify(name) + ' is rejected with a reason');
  }
});

test('validateStateDirName rejects values that are not strings', () => {
  for (const value of [undefined, null, 42, {}, ['records']]) {
    assert.equal(typeof bible.validateStateDirName(value, 'linux'), 'string', JSON.stringify(value) + ' is rejected');
  }
});

test('validateStateDirName rejects the five bible folders, .git, and .claude on every platform', () => {
  for (const name of ['context', 'structure', 'research', 'chapters', 'production', '.git', '.claude']) {
    for (const platform of ['linux', 'darwin', 'win32']) {
      assert.equal(
        typeof bible.validateStateDirName(name, platform), 'string',
        JSON.stringify(name) + ' is reserved on ' + platform
      );
    }
  }
});

test('validateStateDirName folds reserved names without regard to case on win32 only', () => {
  for (const name of ['Chapters', 'RESEARCH', '.GIT', '.Claude']) {
    assert.equal(typeof bible.validateStateDirName(name, 'win32'), 'string', name + ' is reserved on win32');
    assert.equal(bible.validateStateDirName(name, 'linux'), null, name + ' is a different name on linux');
  }
});

// ---- resolution with and without a pointer -------------------------------------------------

test('a book with no pointer uses the default state folder', () => {
  const root = makeBook({ label: 'default', stateDir: bible.DEFAULT_STATE_DIR });
  const found = bible.findBookRoot(root);
  assert.equal(found.stateDirName, bible.DEFAULT_STATE_DIR);
  assert.equal(found.stateDir, join(root, bible.DEFAULT_STATE_DIR));
  assert.equal(bible.stateDirNameOf(root), bible.DEFAULT_STATE_DIR);
});

test('a pointer names a custom state folder, and findBookRoot reads meta.json from it', () => {
  const root = makeBook({ label: 'custom', stateDir: 'records', pointer: { state_dir: 'records' } });
  assert.equal(bible.stateDirNameOf(root), 'records', 'stateDirNameOf follows the pointer');
  assert.equal(bible.stateDirOf(root), join(root, 'records'), 'stateDirOf follows the pointer');
  const found = bible.findBookRoot(root);
  assert.equal(found.root, root);
  assert.equal(found.stateDirName, 'records');
  assert.equal(found.stateDir, join(root, 'records'));
  assert.equal(found.meta.book_title, 'State folder test', 'meta.json came from the custom folder');
});

test('a pointer may name the default folder explicitly', () => {
  const root = makeBook({ label: 'explicit-default', stateDir: bible.DEFAULT_STATE_DIR, pointer: { state_dir: bible.DEFAULT_STATE_DIR } });
  assert.equal(bible.findBookRoot(root).stateDirName, bible.DEFAULT_STATE_DIR);
});

test('readProgress and writeProgressAtomic use the custom state folder', () => {
  const root = makeBook({ label: 'progress', stateDir: 'records', pointer: { state_dir: 'records' } });
  bible.writeProgressAtomic(root, { marker: 'custom-folder' });
  const onDisk = JSON.parse(readFileSync(join(root, 'records', 'progress.json'), 'utf8'));
  assert.equal(onDisk.marker, 'custom-folder', 'the write landed in records/progress.json');
  assert.equal(bible.readProgress(root).marker, 'custom-folder', 'the read came from records/progress.json');
  assert.ok(!existsSync(join(root, bible.DEFAULT_STATE_DIR)), 'nothing was created at the default name');
});

// ---- a bad pointer never falls back to the default -----------------------------------------

const BAD_POINTERS = [
  ['invalid JSON', 'not valid json {{'],
  ['a JSON array', '["records"]'],
  ['no state_dir key', '{}'],
  ['a non-string state_dir', { state_dir: 7 }],
  ['a reserved state_dir', { state_dir: 'chapters' }],
  ['a path-escaping state_dir', { state_dir: '../escape' }],
];

for (const [label, pointer] of BAD_POINTERS) {
  test('a pointer with ' + label + ' is a bad pointer (STATE_POINTER_INVALID), with the root and pointer path attached', () => {
    const root = makeBook({ label: 'bad', stateDir: bible.DEFAULT_STATE_DIR, pointer });
    const fromResolver = assertBibleError(() => bible.stateDirNameOf(root), 'STATE_POINTER_INVALID', 'stateDirNameOf');
    assert.equal(fromResolver.root, root, 'err.root is the book root');
    assert.equal(fromResolver.pointerPath, join(root, POINTER_FILE), 'err.pointerPath is the pointer file');
    const fromWalk = assertBibleError(() => bible.findBookRoot(root), 'STATE_POINTER_INVALID', 'findBookRoot');
    assert.equal(fromWalk.root, root, 'findBookRoot attaches the root too');
    assert.ok(fromWalk.message.includes(POINTER_FILE), 'the message names the pointer file: ' + fromWalk.message);
  });
}

test('a pointer naming a folder that does not exist is a bad pointer, never a fallback to the default', () => {
  // The default folder is present and valid; the pointer names a different, missing one.
  const root = makeBook({ label: 'dangling', stateDir: bible.DEFAULT_STATE_DIR, pointer: { state_dir: 'records' } });
  const err = assertBibleError(() => bible.findBookRoot(root), 'STATE_POINTER_INVALID', 'findBookRoot');
  assert.ok(err.message.includes('records'), 'the message names the missing folder: ' + err.message);
});

test('a pointer naming a folder without meta.json is a bad pointer', () => {
  const root = makeBook({ label: 'no-meta', pointer: { state_dir: 'records' } });
  mkdirSync(join(root, 'records'), { recursive: true });
  assertBibleError(() => bible.findBookRoot(root), 'STATE_POINTER_INVALID', 'findBookRoot');
});

// ---- unpointed state folders are detected, never shadowed ----------------------------------

test('an unpointed state folder stops the walk with NO_BOOK_ROOT, naming the folder and nfs-doctor', () => {
  const root = makeBook({ label: 'unpointed', stateDir: 'records' });
  const err = assertBibleError(() => bible.findBookRoot(root), 'NO_BOOK_ROOT', 'findBookRoot');
  assert.equal(err.root, root, 'err.root is the book whose state folder is unpointed');
  assert.deepEqual(err.candidates, ['records'], 'err.candidates names the folder');
  assert.ok(err.message.includes('records'), 'the message names the folder: ' + err.message);
  assert.ok(err.message.includes('nfs-doctor'), 'the message names the fix: ' + err.message);
});

test('unpointed candidates are sorted by code point, not by locale', () => {
  const root = makeBook({ label: 'sorted' });
  writeStateFolder(root, 'a-state');
  writeStateFolder(root, 'B-state');
  const err = assertBibleError(() => bible.findBookRoot(root), 'NO_BOOK_ROOT', 'findBookRoot');
  // Code point order puts uppercase B (0x42) before lowercase a (0x61); localeCompare would not.
  assert.deepEqual(err.candidates, ['B-state', 'a-state']);
});

test('a legacy .studio/ book is detected as an unpointed state folder, never treated as empty', () => {
  assert.equal(bible.LEGACY_STATE_DIR, '.studio', 'the legacy name is exported for the doctor and the skills');
  assert.notEqual(bible.DEFAULT_STATE_DIR, bible.LEGACY_STATE_DIR, 'the default has moved off the legacy name');
  const root = makeBook({ label: 'legacy', stateDir: '.studio' });
  const err = assertBibleError(() => bible.findBookRoot(root), 'NO_BOOK_ROOT', 'findBookRoot');
  assert.deepEqual(err.candidates, ['.studio'], 'the legacy folder is named');
  assert.equal(err.root, root);
});

test('a legacy .studio/ book keeps working once a pointer records its name', () => {
  const root = makeBook({ label: 'legacy-kept', stateDir: '.studio', pointer: { state_dir: '.studio' } });
  assert.equal(bible.findBookRoot(root).stateDirName, '.studio');
});

test('a folder holding meta.json but no progress.json is not a candidate', () => {
  const root = makeBook({ label: 'meta-only', stateDir: 'notes', withProgress: false });
  const err = assertBibleError(() => bible.findBookRoot(root), 'NO_BOOK_ROOT', 'findBookRoot');
  assert.ok(!err.candidates || err.candidates.length === 0, 'no candidates: ' + JSON.stringify(err.candidates));
});

test('the walk never attaches an unpointed inner book to an enclosing book', () => {
  const outer = makeBook({ label: 'outer', stateDir: bible.DEFAULT_STATE_DIR });
  const drafts = join(outer, 'drafts');
  mkdirSync(drafts, { recursive: true });
  const inner = makeBook({ parent: drafts, label: 'inner', stateDir: 'records' });
  const err = assertBibleError(() => bible.findBookRoot(inner), 'NO_BOOK_ROOT', 'findBookRoot');
  assert.equal(err.root, inner, 'the walk stopped at the inner book');
  assert.deepEqual(err.candidates, ['records']);
});

test('findStateFolderCandidates lists every child folder with the state-folder signature', () => {
  const root = makeBook({ label: 'candidates' });
  writeStateFolder(root, 'records');
  writeStateFolder(root, 'notes', { withProgress: false });
  assert.deepEqual(bible.findStateFolderCandidates(root), ['records']);
});

// ---- layouts and scope of the pointer ------------------------------------------------------

test('the book/ subfolder layout reads its pointer from book/', () => {
  const outer = makeTmpDir('book-layout');
  const book = makeBook({ parent: outer, label: 'book', stateDir: 'records', pointer: { state_dir: 'records' } });
  const found = bible.findBookRoot(outer);
  assert.equal(found.root, book);
  assert.equal(found.stateDirName, 'records');
});

test('a pointer outside a book root is ignored', () => {
  const dir = makeTmpDir('stray-pointer');
  writePointer(dir, 'not valid json {{');
  const child = makeBook({ parent: dir, label: 'child', stateDir: bible.DEFAULT_STATE_DIR });
  assert.equal(bible.findBookRoot(child).root, child, 'an ancestor pointer does not govern the child book');
  assertBibleError(() => bible.findBookRoot(dir), 'NO_BOOK_ROOT', 'a stray pointer is not a book');
});

// ---- the research-librarian write scope follows the resolved state folder ------------------

test('research-librarian may write inside a custom-named state folder and nowhere that merely looks like one', () => {
  const root = makeBook({ label: 'scope', stateDir: 'records', pointer: { state_dir: 'records' } });
  assert.equal(
    checkAgentWriteConstraint('research-librarian', join(root, 'records', 'fetch-log.jsonl'), root, 'linux'),
    null,
    'a write inside the resolved state folder is in scope'
  );
  const otherName = bible.DEFAULT_STATE_DIR === 'records' ? 'elsewhere' : bible.DEFAULT_STATE_DIR;
  const reason = checkAgentWriteConstraint('research-librarian', join(root, otherName, 'x.json'), root, 'linux');
  assert.equal(typeof reason, 'string', 'a folder other than the resolved state folder is out of scope');
  assert.ok(reason.includes('records/'), 'the deny reason names the resolved folder: ' + reason);
});
