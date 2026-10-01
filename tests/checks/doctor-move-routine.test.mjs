// tests/checks/doctor-move-routine.test.mjs
// what-it-is:   pin tests for the state-folder move routine in skills/nfs-doctor/SKILL.md and for
//               the state folder's README in the scaffold (ADR-0015, state folder name)
// what-it-does: the move routine is skill text that the model executes, so these tests pin the
//               parts ADR-0015 makes normative: the modes are advertised, the six steps run in the
//               ADR's order behind a precondition step, the target-name rule matches the resolver in
//               hooks/lib/bible.mjs (derived from its exports, not copied), the rename uses git mv
//               inside a git working tree, a target that exists is refused rather than merged, and
//               a non-interactive session writes nothing. The README tests pin the five things
//               the ADR says the folder's README must say.
// runner:       node --test "tests/checks/*.test.mjs" (picked up by scripts/test-engines.mjs)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STATE_DIR_NAME_RE, RESERVED_STATE_DIR_NAMES, DEFAULT_STATE_DIR, POINTER_FILE } from '../../hooks/lib/bible.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = readFileSync(join(REPO_ROOT, 'skills', 'nfs-doctor', 'SKILL.md'), 'utf8');
const README_REL = 'templates/book-scaffold/' + DEFAULT_STATE_DIR + '/README.md';

/** Returns the text of the "## Move routine" section, up to the next "---" separator. */
function routine() {
  const start = SKILL.indexOf('## Move routine');
  assert.notEqual(start, -1, 'nfs-doctor must carry a "## Move routine" section');
  const end = SKILL.indexOf('\n---\n', start);
  return SKILL.slice(start, end === -1 ? undefined : end);
}

test('the modes are advertised: argument hint and unrecognized-mode message name move-state', () => {
  assert.match(SKILL, /^argument-hint: ".*\bmigrate\b.*\bmove-state <name>.*"$/m);
  assert.match(SKILL, /Valid modes are `report` \(default\), `migrate`, `move-state <name>`/);
});

test('the routine runs the ADR-0015 steps in order, behind a precondition step', () => {
  const text = routine();
  const markers = [
    '0. **Check the preconditions.**',
    '1. **Ask.**',
    '2. **Refuse to merge.**',
    '3. **Change the pointer.**',
    '4. **Rename the folder.**',
    '5. **Add the README.**',
    '6. **Confirm.**',
  ];
  let last = -1;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    assert.ok(idx > last, 'step marker missing or out of order: ' + marker);
    last = idx;
  }
});

test('the target-name rule matches the resolver in bible.mjs', () => {
  const text = routine();
  assert.ok(text.includes('`' + STATE_DIR_NAME_RE.source + '`'), 'the name pattern must match STATE_DIR_NAME_RE');
  for (const name of RESERVED_STATE_DIR_NAMES) {
    assert.ok(text.includes('`' + name + '`'), 'the reserved name ' + name + ' must be named');
  }
  assert.match(text, /without regard to case/);
});

test('the rename uses git mv inside a git working tree, and refuses an existing target', () => {
  const text = routine();
  assert.ok(text.includes('then git mv -- "<from>" "<to>"; else mv -- "<from>" "<to>"; fi'));
  assert.ok(text.includes('test -e "<to>" && echo EXISTS || echo FREE'));
  assert.match(text, /two state folders are never merged/);
});

test('the pointer is written, or deleted for the default name, before the rename', () => {
  const text = routine();
  assert.ok(text.includes('`{"state_dir": "<to>"}`'));
  assert.ok(text.includes('`rm -f ' + POINTER_FILE + '`'));
  assert.ok(text.indexOf('3. **Change the pointer.**') < text.indexOf('4. **Rename the folder.**'));
  assert.match(text, /undo it by restoring `nonfiction-studio\.json`/, 'a failed rename tells the author how to undo');
});

test('nothing is written without an explicit yes, and never in a non-interactive session', () => {
  const text = routine();
  assert.match(text, /Wait for an explicit yes\. Anything else writes nothing/);
  assert.match(text, /not available in a non-interactive session\." and write nothing/);
});

test('the README the routine copies exists, and says the five things ADR-0015 lists', () => {
  assert.ok(routine().includes('`<plugin-root>/' + README_REL + '`'), 'the routine copies the scaffold README');
  const path = join(REPO_ROOT, ...README_REL.split('/'));
  assert.ok(existsSync(path), README_REL + ' must exist');
  const readme = readFileSync(path, 'utf8');
  assert.match(readme, /holds Nonfiction Studio's records for this book/, '1: what the folder holds');
  assert.match(readme, /Commit it with the rest of the book, because the AI-use log/, '2: commit it, for the AI-use log');
  assert.match(readme, /`config\.json` is the only file here meant for hand editing/, '3: config.json is the hand-edited file');
  assert.match(readme, /`\/nonfiction-studio:nfs-doctor move-state <name>`/, '4a: rename with move-state');
  assert.ok(readme.includes('`' + POINTER_FILE + '` at the book root'), '4b: a non-default name lives in the pointer');
  assert.match(readme, /documentation explains each file/, '5: the docs explain each file');
});
