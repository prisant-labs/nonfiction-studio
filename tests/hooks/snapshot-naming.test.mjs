// tests/hooks/snapshot-naming.test.mjs
// what-it-is:   the snapshot-name contract between hooks/pre-tool-use.mjs, which writes
//               snapshots, and doctor check 10 (snapshot naming conformance), which reads them
// what-it-does: proves the doctor accepts every name the hook actually writes (a millisecond
//               timestamp, a collision counter, a free-form chapter slug as ADR-0016 allows),
//               still rejects names that break the pattern, and that the hook's newest-10 prune
//               for one chapter never touches another chapter's snapshots whose slug merely
//               starts with the same text
// why:          the hook has written millisecond timestamps since F-HK-03 while the doctor
//               accepted only whole seconds, so every hook snapshot was a doctor finding
// runner:       node --test "tests/hooks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runChecks } from '../../hooks/lib/doctor-engine.mjs';
import { REPO_ROOT } from '../lib/adopted-books.mjs';

const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');
const HOOK = join(REPO_ROOT, 'hooks', 'pre-tool-use.mjs');

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function cloneBook(label) {
  const dir = mkdtempSync(join(tmpdir(), 'ns-snapname-' + label + '-'));
  made.push(dir);
  const book = join(dir, 'book');
  cpSync(SAMPLE_BOOK, book, { recursive: true });
  return book;
}

function overwrite(book, file) {
  const event = {
    session_id: 's', transcript_path: '/tmp/t.jsonl', cwd: book, hook_event_name: 'PreToolUse',
    tool_name: 'Write', tool_input: { file_path: file, content: 'x' }, tool_use_id: 't1',
  };
  const result = spawnSync('node', [HOOK], { input: JSON.stringify(event), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

const snapshotDir = (book) => join(book, '_nonfiction-studio', 'snapshots');
const badNames = (book) => runChecks(book).findings.filter((f) => f.type === 'snapshot.bad-name').map((f) => f.path);

test('a snapshot the PreToolUse hook writes passes the doctor\'s naming check', () => {
  const book = cloneBook('hook');
  overwrite(book, join(book, 'chapters', '01-listening-before-speaking.md'));
  assert.ok(readdirSync(snapshotDir(book)).length >= 2, 'the hook wrote a snapshot');
  assert.deepEqual(badNames(book), []);
});

test('the doctor accepts a collision counter and a free-form chapter slug', () => {
  const book = cloneBook('forms');
  for (const name of [
    '01-listening-before-speaking.20261004T223750232Z-2.md',
    "Author's Afterword.20261004T223750232Z.md",
    'ch01.draft.20261004T223750Z.md',
  ]) {
    writeFileSync(join(snapshotDir(book), name), 'x');
  }
  assert.deepEqual(badNames(book), []);
});

test('the doctor still rejects names that break the pattern', () => {
  const book = cloneBook('bad');
  const bad = ['notes.md', '01-x.2026.md', '01-x.20261004T2237Z.md', '01-x.20261004T223750Z.txt', '.20261004T223750Z.md'];
  for (const name of bad) writeFileSync(join(snapshotDir(book), name), 'x');
  assert.equal(badNames(book).length, bad.length - 1, 'every bad name but the dot-file is a finding: ' + badNames(book).join(', '));
});

test('pruning one chapter\'s snapshots never deletes another chapter\'s that share a prefix', () => {
  const book = cloneBook('prune');
  writeFileSync(join(book, 'chapters', 'ch01.md'), '# One\n');
  const others = [];
  for (let i = 10; i < 22; i++) {
    const name = 'ch01.x.20250101T0000' + i + 'Z.md';
    others.push(name);
    writeFileSync(join(snapshotDir(book), name), 'x');
  }
  overwrite(book, join(book, 'chapters', 'ch01.md'));
  const left = readdirSync(snapshotDir(book));
  for (const name of others) assert.ok(left.includes(name), 'kept ' + name);
  assert.equal(left.filter((f) => /^ch01\.\d{8}T/.test(f)).length, 1, 'the new ch01 snapshot is kept');
});
