// tests/checks/new-book-existence-check.test.mjs
// what-it-is:   pin and behavior tests for the existence check in skills/nfs-new-book/SKILL.md's
//               Step 1, which detects an unpointed state folder before the new-book flow can
//               stamp a second one beside it (ADR-0015, state folder name)
// what-it-does: (1) pins the skill text: Step 1's command carries the unpointed-folder loop, and
//               the prose stops the flow on an `UNPOINTED:` line and names nfs-doctor; (2) runs
//               the command itself, with <state-dir> substituted as the stanza directs, against
//               five book layouts and asserts its output. The behavior tests need a POSIX bash
//               and are skipped on win32, where `bash` on a CI runner can resolve to WSL rather
//               than Git Bash (the reason tests/checks/plugin-root-resolver.test.mjs never runs a
//               real bash); the ubuntu leg runs them.
// runner:       node --test "tests/checks/*.test.mjs" (picked up by scripts/test-engines.mjs)

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { REPO_ROOT, makeBook, makeTmpDir } from '../lib/state-folder-books.mjs';

const SKILL = join(REPO_ROOT, 'skills', 'nfs-new-book', 'SKILL.md');
const POSIX_ONLY = { skip: process.platform === 'win32' && 'needs a POSIX bash; the ubuntu leg runs it' };

const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** Returns the first fenced command under Step 1's heading. */
function stepOneCommand() {
  const text = readFileSync(SKILL, 'utf8');
  const start = text.indexOf('## Step 1 - Run the existence check');
  assert.notEqual(start, -1, 'nfs-new-book must keep its Step 1 heading');
  const open = text.indexOf('```\n', start);
  const close = text.indexOf('\n```', open + 4);
  return { text, section: text.slice(start, text.indexOf('\n## ', start + 1)), command: text.slice(open + 4, close) };
}

/** Runs Step 1's command in `cwd` with <state-dir> replaced by `stateDir`; returns stdout lines. */
function runStepOne(cwd, stateDir) {
  const script = stepOneCommand().command.split('<state-dir>').join(stateDir);
  const result = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8' });
  assert.equal(result.error, undefined, String(result.error));
  return result.stdout.split('\n').filter(Boolean);
}

function track(dir) {
  made.push(dir);
  return dir;
}

test('pin: Step 1 runs the unpointed-folder loop in the same call as the existence check', () => {
  const { command } = stepOneCommand();
  assert.match(command, /for d in \*\/ \.\*\/; do/, 'the loop covers hidden folders too');
  assert.match(command, /\[ -f "\$d\/meta\.json" \] && \[ -f "\$d\/progress\.json" \] && echo "UNPOINTED: \$d"/);
  assert.match(command, /<state-dir>\) continue;;/, 'the resolved state folder itself is skipped');
  assert.match(command, /then echo REINIT; else echo NEWINIT; fi/);
});

test('pin: an UNPOINTED line stops the flow, writes nothing, and names nfs-doctor', () => {
  const { section } = stepOneCommand();
  assert.match(section, /\*\*If any line starts with `UNPOINTED:`, stop\.\*\* Write nothing/);
  assert.match(section, /Run \/nonfiction-studio:nfs-doctor/);
});

test('behavior: a legacy .studio/ book prints UNPOINTED before REINIT', POSIX_ONLY, () => {
  const root = track(makeBook({ label: 'nb-legacy', stateDir: '.studio' }));
  writeFileSync(join(root, 'context', 'brief.md'), '# Brief\n');
  assert.deepEqual(runStepOne(root, '_nonfiction-studio'), ['UNPOINTED: .studio', 'REINIT']);
});

test('behavior: a healthy book on the default folder prints only REINIT', POSIX_ONLY, () => {
  const root = track(makeBook({ label: 'nb-healthy', stateDir: '_nonfiction-studio' }));
  assert.deepEqual(runStepOne(root, '_nonfiction-studio'), ['REINIT']);
});

test('behavior: a pointed custom folder is the resolved folder, not a second one', POSIX_ONLY, () => {
  const root = track(makeBook({ label: 'nb-custom', stateDir: 'book-state', pointer: { state_dir: 'book-state' } }));
  assert.deepEqual(runStepOne(root, 'book-state'), ['REINIT']);
});

test('behavior: a leftover default folder beside a pointed custom one is reported', POSIX_ONLY, () => {
  const root = track(makeBook({ label: 'nb-leftover', stateDir: 'book-state', pointer: { state_dir: 'book-state' } }));
  mkdirSync(join(root, '_nonfiction-studio'));
  writeFileSync(join(root, '_nonfiction-studio', 'meta.json'), '{}\n');
  writeFileSync(join(root, '_nonfiction-studio', 'progress.json'), '{}\n');
  assert.deepEqual(runStepOne(root, 'book-state'), ['UNPOINTED: _nonfiction-studio', 'REINIT']);
});

test('behavior: an empty directory prints only NEWINIT', POSIX_ONLY, () => {
  const root = track(makeTmpDir('nb-empty'));
  assert.deepEqual(runStepOne(root, '_nonfiction-studio'), ['NEWINIT']);
});
