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
//               and asserts its output. The behavior tests need a real POSIX bash. On win32,
//               plain `bash` on PATH can resolve to WSL's bash.exe rather than Git Bash (the
//               shell Claude Code's own Bash tool actually runs Windows commands through, and
//               the reason tests/checks/plugin-root-resolver.test.mjs never runs a real bash at
//               all), so this file locates Git Bash explicitly via `resolveGitBash()` below
//               instead of trusting PATH: it reads `git --exec-path`, walks up to the Git for
//               Windows install root, and looks for bin/bash.exe then usr/bin/bash.exe there,
//               never WSL. `NFS_TEST_GIT_BASH` overrides that search with an explicit path, for
//               a machine where Git for Windows is not laid out the way that walk expects. The
//               spawned bash also gets the install root's usr/bin prepended to its PATH, so its
//               `find` resolves to Git's own coreutils rather than anything else named `find` on
//               the system (a defensive measure; this walk's own candidates already land inside
//               that usr/bin, which the MSYS runtime also puts first on its own). The behavior
//               tests now run on win32 too, under that resolved Git Bash; they are skipped only
//               when no Git Bash can be found at all (and the skip message says so). The ubuntu
//               leg is unaffected: it resolves plain `bash` from PATH as before.
// runner:       node --test "tests/checks/*.test.mjs" (picked up by scripts/test-engines.mjs)

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import { REPO_ROOT, makeBook, makeTmpDir } from '../lib/state-folder-books.mjs';

const SKILL = join(REPO_ROOT, 'skills', 'nfs-new-book', 'SKILL.md');

/**
 * Locates a real Git Bash on win32, bypassing PATH (where plain `bash` can resolve to WSL's
 * bash.exe ahead of Git's). `NFS_TEST_GIT_BASH` overrides the search outright. Otherwise reads
 * `git --exec-path` (typically `<git-root>/mingw64/libexec/git-core`), walks up three levels to
 * the Git for Windows install root, and checks `bin/bash.exe` then `usr/bin/bash.exe` there.
 * Returns `{ bash: null, usrBin: null }` when no override is set and none of that resolves, so
 * the caller can skip with a reason rather than risk running WSL's bash. On any other platform
 * returns `{ bash: 'bash', usrBin: null }`, resolved from PATH exactly as before.
 */
function resolveGitBash() {
  if (process.platform !== 'win32') return { bash: 'bash', usrBin: null };
  const override = process.env.NFS_TEST_GIT_BASH;
  if (override) return { bash: existsSync(override) ? override : null, usrBin: null };
  let execPath;
  try {
    execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
  } catch {
    return { bash: null, usrBin: null };
  }
  if (!execPath) return { bash: null, usrBin: null };
  let root = execPath;
  for (let i = 0; i < 3; i++) root = dirname(root);
  const usrBin = join(root, 'usr', 'bin');
  for (const rel of [['bin', 'bash.exe'], ['usr', 'bin', 'bash.exe']]) {
    const candidate = join(root, ...rel);
    if (existsSync(candidate)) return { bash: candidate, usrBin };
  }
  return { bash: null, usrBin: null };
}

const { bash: BASH, usrBin: USR_BIN } = resolveGitBash();

/** PATH, with the Git for Windows usr/bin directory prepended when Git Bash was resolved by path. */
function bashEnv() {
  if (!USR_BIN) return process.env;
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  return { ...process.env, [pathKey]: USR_BIN + ';' + (process.env[pathKey] || '') };
}

const POSIX_ONLY = {
  skip: BASH === null && 'no Git Bash found (checked NFS_TEST_GIT_BASH and the git --exec-path walk); refusing to fall back to WSL bash',
};

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
  const result = spawnSync(BASH, ['-c', script], { cwd, encoding: 'utf8', env: bashEnv() });
  assert.equal(result.error, undefined, String(result.error));
  return result.stdout.split('\n').filter(Boolean);
}

function track(dir) {
  made.push(dir);
  return dir;
}

test('behavior: the resolved bash runs a real POSIX find, not Windows find.exe', POSIX_ONLY, () => {
  const result = spawnSync(BASH, ['-c', 'command -v find'], { encoding: 'utf8', env: bashEnv() });
  assert.equal(result.error, undefined, String(result.error));
  const found = result.stdout.trim();
  // Accepts any POSIX find (ubuntu's /usr/bin/find, Git for Windows' /usr/bin/find); rejects
  // Windows' own find.exe or anything that looks like it came from System32 or a .exe path.
  assert.match(found, /\/find$/, found);
  assert.doesNotMatch(found, /\.exe$|[Ww]indows|[Ss]ystem32/, found);
});

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
