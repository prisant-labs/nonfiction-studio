// tests/checks/new-book-existence-check.test.mjs
// what-it-is:   pin and behavior tests for the existence check in skills/nfs-new-book/SKILL.md's
//               Step 1, which detects an unpointed state folder before the new-book flow can
//               stamp a second one beside it (ADR-0015, state folder name), and detects existing
//               writing before the flow can stamp an empty project beside a manuscript
//               (ADR-0016, adopting an existing book)
// what-it-does: (1) pins the skill text: Step 1's command carries the unpointed-folder loop and,
//               on the NEWINIT branch only, the existing-writing search, which skips hidden folders and files; the prose stops the flow
//               on an `UNPOINTED:` or a `WRITING:` line; (2) runs the command itself, with
//               <state-dir> substituted as the stanza directs, against book and folder layouts
//               and asserts its output. The behavior tests need a POSIX bash
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
  assert.match(command, /then echo REINIT; else .*echo NEWINIT; fi/);
});

test('pin: the existing-writing search runs only on the NEWINIT branch', () => {
  const { command } = stepOneCommand();
  assert.match(
    command,
    /then echo REINIT; else find \. .* \| head -n 3 \| sed 's\/\^\/WRITING: \/'; echo NEWINIT; fi/,
    'the search sits inside the else branch, before NEWINIT'
  );
  assert.match(
    command,
    /find \. -mindepth 1 -name '\.\*' -prune -o /,
    'skips hidden folders and files; -mindepth 1 keeps the start point "." from matching ".*" and pruning everything'
  );
  assert.match(command, /! -path \.\/README\.md/, 'exempts only the top-level README.md');
});

test('pin: a WRITING line stops the flow, writes nothing, and names nfs-adopt (ADR-0016)', () => {
  const { section } = stepOneCommand();
  assert.match(section, /\*\*If any line starts with `WRITING:`, stop\.\*\* Write nothing/);
  assert.match(section, /\/nonfiction-studio:nfs-adopt/, 'names the skill that adopts the writing in place');
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

/** Writes each relative path in `files` under `root` with placeholder Markdown. */
function writeFiles(root, files) {
  for (const rel of files) {
    const path = join(root, ...rel.split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '# x\n');
  }
}

test('behavior: a folder of existing writing prints WRITING before NEWINIT', POSIX_ONLY, () => {
  const root = track(makeTmpDir('nb-writing'));
  writeFiles(root, ['README.md', 'manuscript/ch01.md']);
  assert.deepEqual(runStepOne(root, '_nonfiction-studio'), ['WRITING: ./manuscript/ch01.md', 'NEWINIT']);
});

test('behavior: the extension matches without regard to case, and .markdown counts', POSIX_ONLY, () => {
  for (const name of ['NOTES.MD', 'draft.markdown']) {
    const root = track(makeTmpDir('nb-ext'));
    writeFiles(root, [name]);
    assert.deepEqual(runStepOne(root, '_nonfiction-studio'), ['WRITING: ./' + name, 'NEWINIT']);
  }
});

test('behavior: a README.md below the top level counts as writing', POSIX_ONLY, () => {
  const root = track(makeTmpDir('nb-nested-readme'));
  writeFiles(root, ['README.md', 'notes/README.md']);
  assert.deepEqual(runStepOne(root, '_nonfiction-studio'), ['WRITING: ./notes/README.md', 'NEWINIT']);
});

test('behavior: at most three WRITING lines are printed', POSIX_ONLY, () => {
  const root = track(makeTmpDir('nb-many'));
  writeFiles(root, ['a.md', 'b.md', 'c.md', 'd.md', 'e.md']);
  const lines = runStepOne(root, '_nonfiction-studio');
  assert.equal(lines.length, 4, lines.join('\n'));
  assert.ok(lines.slice(0, 3).every((l) => l.startsWith('WRITING: ./')));
  assert.equal(lines[3], 'NEWINIT');
});

test('behavior: a top-level README.md alone is not existing writing', POSIX_ONLY, () => {
  const root = track(makeTmpDir('nb-readme'));
  writeFiles(root, ['README.md']);
  assert.deepEqual(runStepOne(root, '_nonfiction-studio'), ['NEWINIT']);
});

test('behavior: Markdown in hidden tool folders is not existing writing [mutation-proof: dropping the prune turns this red]', POSIX_ONLY, () => {
  const root = track(makeTmpDir('nb-tooling'));
  writeFiles(root, [
    '.git/description.md',
    '.claude/skills/x/SKILL.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.cursor/rules/style.md',
  ]);
  assert.deepEqual(runStepOne(root, '_nonfiction-studio'), ['NEWINIT']);
});

test('behavior: a hidden folder below the top level and a hidden top-level file are not existing writing', POSIX_ONLY, () => {
  const root = track(makeTmpDir('nb-hidden-deep'));
  writeFiles(root, ['notes/.drafts/x.md', '.notes.md']);
  assert.deepEqual(runStepOne(root, '_nonfiction-studio'), ['NEWINIT']);
});

test('behavior: writing beside hidden tool folders is found, and the hidden folders are never named [mutation-proof: dropping -mindepth 1 turns this red]', POSIX_ONLY, () => {
  const root = track(makeTmpDir('nb-beside-tooling'));
  writeFiles(root, ['.cursor/rules/a.md', 'manuscript/ch01.md']);
  assert.deepEqual(runStepOne(root, '_nonfiction-studio'), ['WRITING: ./manuscript/ch01.md', 'NEWINIT']);
});

test('behavior: a plugin book with Markdown chapters prints only REINIT [mutation-proof: an ungated search turns this red]', POSIX_ONLY, () => {
  const root = track(makeBook({ label: 'nb-chapters', stateDir: '_nonfiction-studio' }));
  writeFiles(root, ['chapters/01-opening.md']);
  assert.deepEqual(runStepOne(root, '_nonfiction-studio'), ['REINIT']);
});
