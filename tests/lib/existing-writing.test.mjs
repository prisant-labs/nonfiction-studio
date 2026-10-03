// tests/lib/existing-writing.test.mjs
// what-it-is:   unit tests for hooks/lib/existing-writing.mjs
// what-it-does: verifies findExistingWriting against the ADR-0016 (adopting an existing book)
//               definition of existing writing: Markdown files outside hidden folders and files
//               (names beginning with a dot), other than a top-level README.md. Also verifies the
//               walk's order and its entry budget.
// runner:       node --test tests/lib/existing-writing.test.mjs (or node --test tests/lib/)

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { findExistingWriting } from '../../hooks/lib/existing-writing.mjs';
import { makeTmpDir } from './state-folder-books.mjs';

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A fresh temp directory holding `files` (relative paths, forward slashes). */
function dirWith(label, files) {
  const root = makeTmpDir('writing-' + label);
  made.push(root);
  for (const rel of files) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), '# x\n', 'utf8');
  }
  return root;
}

test('an empty directory holds no existing writing', () => {
  assert.deepEqual(findExistingWriting(dirWith('empty', [])), { found: null, exhausted: false });
});

test('a top-level README.md alone is not existing writing', () => {
  assert.deepEqual(findExistingWriting(dirWith('readme', ['README.md'])), { found: null, exhausted: false });
});

test('a Markdown file in a subfolder is existing writing, reported with forward slashes', () => {
  const root = dirWith('manuscript', ['README.md', 'manuscript/ch01.md']);
  assert.deepEqual(findExistingWriting(root), { found: 'manuscript/ch01.md', exhausted: false });
});

test('a top-level Markdown file other than README.md is existing writing', () => {
  assert.equal(findExistingWriting(dirWith('top', ['README.md', 'outline.md'])).found, 'outline.md');
});

test('a README.md below the top level is existing writing', () => {
  assert.equal(findExistingWriting(dirWith('nested-readme', ['README.md', 'notes/README.md'])).found, 'notes/README.md');
});

test('the extension matches without regard to case, and .markdown counts', () => {
  assert.equal(findExistingWriting(dirWith('upper', ['NOTES.MD'])).found, 'NOTES.MD');
  assert.equal(findExistingWriting(dirWith('long-ext', ['draft.markdown'])).found, 'draft.markdown');
});

test('files that are not Markdown are not existing writing', () => {
  const root = dirWith('other', ['notes.txt', 'draft.docx', 'src/index.js', 'md/readme']);
  assert.deepEqual(findExistingWriting(root), { found: null, exhausted: false });
});

test('Markdown in hidden tool folders is not existing writing [mutation-proof: walking hidden folders turns this red]', () => {
  const root = dirWith('tooling', [
    '.git/description.md',
    '.claude/skills/x/SKILL.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.cursor/rules/style.md',
  ]);
  assert.deepEqual(findExistingWriting(root), { found: null, exhausted: false });
});

test('a hidden folder below the top level and a hidden top-level file are not existing writing', () => {
  const root = dirWith('hidden-deep', ['notes/.drafts/x.md', '.notes.md']);
  assert.deepEqual(findExistingWriting(root), { found: null, exhausted: false });
});

test('writing beside hidden tool folders is found, and the hidden folders are never reported', () => {
  const root = dirWith('beside-tooling', ['.cursor/rules/a.md', 'manuscript/ch01.md']);
  assert.equal(findExistingWriting(root).found, 'manuscript/ch01.md');
});

test('the walk is breadth-first: a shallow match wins over a deeper one that sorts first', () => {
  const root = dirWith('breadth', ['a/b/c/deep.md', 'z/shallow.md']);
  assert.equal(findExistingWriting(root).found, 'z/shallow.md');
});

test('the walk sorts each listing by code unit, not localeCompare, so the result does not depend on the platform', () => {
  // Code-unit order puts 'C.md' (0x43) before 'a.md' (0x61); localeCompare would put 'a.md' first.
  const root = dirWith('order', ['b.md', 'a.md', 'C.md']);
  assert.equal(findExistingWriting(root).found, 'C.md');
});

test('an exhausted budget reports no match and exhausted: true', () => {
  const root = dirWith('budget', ['1.txt', '2.txt', '3.txt', 'deep/ch01.md']);
  assert.deepEqual(findExistingWriting(root, { budget: 2 }), { found: null, exhausted: true });
});

test('a match found within the budget is reported even when the tree is larger', () => {
  const root = dirWith('budget-hit', ['a.md', 'x1.txt', 'x2.txt', 'x3.txt']);
  assert.deepEqual(findExistingWriting(root, { budget: 2 }), { found: 'a.md', exhausted: false });
});

test('an unreadable root directory throws, so the caller decides how to fail open', () => {
  assert.throws(() => findExistingWriting(join(dirWith('gone', []), 'missing')));
});
