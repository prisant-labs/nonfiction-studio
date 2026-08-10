// tests/checks/check-workspace-refs.test.mjs
// what-it-is:   planted-violation tests for scripts/checks/check-workspace-refs.mjs
// what-it-does: runs the real checker script (a standalone process, invoked directly, not a
//               check(ctx) module) against isolated fixtures, with a violation planted into the
//               fixture only, never into the live working tree. Two fixture styles are used
//               deliberately:
//                 (1) synthetic fixtures (buildSyntheticRoot below): a from-scratch temp directory
//                     with its OWN invented .gitignore, so the genericity claim (the forbidden set
//                     comes from parsing .gitignore, not from a hardcoded directory list) can be
//                     proven directly with a gitignored directory name that has nothing to do with
//                     this repo's real scratch workspaces, and so the clean-case and false-positive
//                     tests can assert an exact exit code without the real repo's own pre-existing
//                     content (see the note above the real-repo tests below) making the assertion
//                     unreliable;
//                 (2) real-repo clones (clone-helper.mjs's cloneRepoToTemp, reused per this task's
//                     brief), which exercise the checker against the actual scan scope and the
//                     actual .gitignore, proving the mechanism also works end to end, not only in
//                     miniature.
//               Every fixture gets a fresh copy of THIS REPO'S CURRENT on-disk checker script (see
//               copyFromRepo, buildSyntheticRoot, and cloneRealRepo below), copied in directly
//               rather than relying on the script being staged in git's index, so the test suite is
//               never coupled to staging order during iteration.
// self-matching discipline: real gitignored-directory names (_local, .superpowers) used together
//               WITH a trailing path segment, and any real basename that already exists only under
//               this repo's real scratch directories, are exactly what this checker searches for -
//               so anywhere this file needs that combination for a real-repo test, it is assembled
//               from separate string parts at runtime (never written contiguously here), the same
//               discipline tests/checks/check-self-sufficiency.test.mjs uses for its own planted
//               secret-shaped strings. Synthetic fixtures use entirely invented directory and file
//               names that do not appear in this repo's real .gitignore, so the checker (running
//               over the real repo, including this tracked file) never recognizes them as anything
//               other than ordinary text; those are written directly, with no construction needed.
// why:          F6 (checker negative tests) - "a checker that cannot fail is not a checker"; this
//               task's own acceptance criteria require both detection forms proven by planted-
//               violation tests that name what they planted, the forbidden-set-from-.gitignore
//               claim proven directly, and proof the checker does not flag itself, its own tests,
//               or ordinary prose.
// runner:       node --test "tests/checks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, snapshotPaths, diffPathSnapshots, REPO_ROOT } from './clone-helper.mjs';

const SCRIPT = 'scripts/checks/check-workspace-refs.mjs';
const TEST_FILE_REL = 'tests/checks/check-workspace-refs.test.mjs';

after(() => {
  cleanupGoldenClone();
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function safeRemove(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort, mirrors clone-helper.mjs's own safeRemove
  }
}

/** Copies a repo-relative file from the real, current working tree into a fixture root. */
function copyFromRepo(fixtureRoot, relPath) {
  const src = join(REPO_ROOT, ...relPath.split('/'));
  const dst = join(fixtureRoot, ...relPath.split('/'));
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
}

/**
 * Builds a from-scratch temp directory carrying its own .gitignore and shipped
 * files, plus a fresh copy of this repo's CURRENT on-disk checker script. Not
 * derived from the real tracked tree at all, so assertions here are never
 * contaminated by anything already present in this repo.
 */
function buildSyntheticRoot(label, gitignoreLines, files) {
  const root = mkdtempSync(join(tmpdir(), 'nonfiction-workspace-refs-synth-' + label + '-'));
  writeFileSync(join(root, '.gitignore'), gitignoreLines.join('\n') + '\n');
  copyFromRepo(root, SCRIPT);
  for (const [relPath, content] of Object.entries(files)) {
    const dst = join(root, ...relPath.split('/'));
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, content);
  }
  return { root, cleanup: () => safeRemove(root) };
}

/** cloneRepoToTemp, but with this repo's CURRENT on-disk checker script copied over
 *  whatever the git-tracked snapshot provided, so tests never depend on the script
 *  being staged. */
function cloneRealRepo(label) {
  const { root, cleanup } = cloneRepoToTemp(label);
  copyFromRepo(root, SCRIPT);
  return { root, cleanup };
}

// ---------------------------------------------------------------------------
// Working-tree-untouched proof (test-fixtures.mjs's temp-clone discipline,
// applied to this file's real-repo-clone tests). All planted content in this
// file's real-repo tests targets brand-new filenames that must never exist
// live; synthetic-root tests never touch REPO_ROOT at all.
// ---------------------------------------------------------------------------

const WATCHED_LIVE_PATHS = [
  'docs/_task11-planted-path-ref.md',
  'docs/_task11-planted-bare-ref.md',
];

const beforeWatchedSnapshot = snapshotPaths(WATCHED_LIVE_PATHS);

after(() => {
  const diff = diffPathSnapshots(beforeWatchedSnapshot, snapshotPaths(WATCHED_LIVE_PATHS));
  assert.deepEqual(
    diff, [],
    'the live repo paths this file plants into must be unchanged after every clone/plant/run; diff: ' + diff.join(', ')
  );
});

// ---------------------------------------------------------------------------
// Baseline: a synthetic fixture with no workspace-scratch references at all.
// ---------------------------------------------------------------------------

test('clean synthetic fixture (no workspace-scratch references) exits 0', () => {
  const { root, cleanup } = buildSyntheticRoot('clean', ['node_modules/', 'planning-scratch/'], {
    'NOTES.md': 'This project ships a small CLI. See the docs folder for more.\n',
    'docs/guide.md': 'Ordinary prose about the product, with no gitignored-path mentions at all.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'must exit 0 on a clean fixture; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Genericity (synthetic): the forbidden set is derived from .gitignore, not
// from a hardcoded directory list. Both detection forms proven against an
// invented directory name that has no relationship to this repo's real
// scratch workspaces.
// ---------------------------------------------------------------------------

test('genericity, form 1 (path reference): an invented gitignored directory declared only in a synthetic .gitignore is still caught', () => {
  const { root, cleanup } = buildSyntheticRoot(
    'form1',
    ['node_modules/', 'planning-scratch/'],
    {
      'docs/example.md': 'See planning-scratch/deep-notes.md for the full rationale.\n',
    }
  );
  try {
    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /docs\/example\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /workspace path reference/, 'message must name the violation type');
    assert.match(result.combined, /planning-scratch\/deep-notes\.md/, 'message must name the planted path');
  } finally {
    cleanup();
  }
});

test('genericity, form 2 (bare filename): a basename that exists only under an invented gitignored directory is still caught', () => {
  const { root, cleanup } = buildSyntheticRoot(
    'form2',
    ['node_modules/', 'planning-scratch/'],
    {
      'planning-scratch/rationale-99.md': 'A file that exists only under the invented scratch directory.\n',
      'docs/example.md': 'The 13 cases from rationale-99.md still apply here.\n',
    }
  );
  try {
    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /docs\/example\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /bare workspace filename reference/, 'message must name the violation type');
    assert.match(result.combined, /rationale-99\.md/, 'message must name the planted basename');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Real-repo integration: proves the mechanism against the actual scan scope
// and the actual .gitignore, not only a miniature fixture. The real
// gitignored-directory name used here ("_local") together with a trailing
// path is exactly the shape this checker searches for, so the planted string
// is assembled from separate parts at runtime per this file's header note.
// ---------------------------------------------------------------------------

test('real-repo scope, form 1: a path reference into the real _local/ directory, planted in a new shipped file, is caught', () => {
  const { root, cleanup } = cloneRealRepo('real-form1');
  try {
    const dirName = '_local';
    const plantedPath = dirName + '/' + 'zzz-task11-planted-dir' + '/' + 'notes.md';
    const target = join(root, 'docs', '_task11-planted-path-ref.md');
    writeFileSync(target, 'Planted for task 11: see ' + plantedPath + ' for context.\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /docs\/_task11-planted-path-ref\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /workspace path reference/, 'message must name the violation type');
  } finally {
    cleanup();
  }
});

test('real-repo scope, form 2: a bare mention of a basename that exists only under a freshly planted _local/ file is caught', () => {
  const { root, cleanup } = cloneRealRepo('real-form2');
  try {
    const basename = 'zzz-task11-planted-marker.md';
    const gitignoredFile = join(root, '_local', '_task11-planted', basename);
    mkdirSync(dirname(gitignoredFile), { recursive: true });
    writeFileSync(gitignoredFile, 'Planted for task 11: exists only under a gitignored directory.\n');

    const target = join(root, 'docs', '_task11-planted-bare-ref.md');
    writeFileSync(target, 'Planted for task 11: see ' + basename + ' for the full list.\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /docs\/_task11-planted-bare-ref\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /bare workspace filename reference/, 'message must name the violation type');
    assert.match(result.combined, /zzz-task11-planted-marker\.md/, 'message must name the planted basename');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Form 3 (task-workspace prose citation): four unambiguous literal shapes,
// independent of the .gitignore-derived forbidden-directory set, added per
// item 6 of the fix wave (C2, enforcement theater). Planted strings are
// assembled from separate parts at runtime, per this file's self-matching
// discipline above, so this file's own source text never contains one of the
// four shapes contiguously.
// ---------------------------------------------------------------------------

test('form 3: "task-N brief" and "task-N report" shapes are caught', () => {
  const { root, cleanup } = buildSyntheticRoot('form3-tasknum', ['node_modules/', 'planning-scratch/'], {
    'docs/example.md':
      'Evaluation order matches the ' + 'task-4' + ' ' + 'brief' + '\'s finding table.\n' +
      'See ' + 'task-9' + ' ' + 'report' + ' for the full write-up.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /docs\/example\.md:1:/, 'line 1 finding present');
    assert.match(result.combined, /docs\/example\.md:2:/, 'line 2 finding present');
    assert.match(result.combined, /task-workspace prose citation/, 'message must name the violation type');
  } finally {
    cleanup();
  }
});

test('form 3: the two "the task" + brief/report shapes are caught', () => {
  const { root, cleanup } = buildSyntheticRoot('form3-thetask', ['node_modules/', 'planning-scratch/'], {
    'docs/example.md':
      'Reasoning is detailed in ' + 'the task' + ' brief' + '.\n' +
      'See ' + 'the task' + ' report' + ' for the full reasoning.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /docs\/example\.md:1:/, 'line 1 finding present');
    assert.match(result.combined, /docs\/example\.md:2:/, 'line 2 finding present');
    assert.match(result.combined, /task-workspace prose citation/, 'message must name the violation type');
  } finally {
    cleanup();
  }
});

test('form 3 false-positive guard: bare "per the brief", a bare "task-4" with no brief/report word, and "the task force" are not flagged', () => {
  const { root, cleanup } = buildSyntheticRoot('form3-fp', ['node_modules/', 'planning-scratch/'], {
    'docs/example.md':
      'This behavior is documented per the brief.\n' +
      'See task-4 for the earlier discussion.\n' +
      'The task force met yesterday to plan the release.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0,
      'ordinary prose that is not one of the four form-3 shapes must not be flagged; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('form 3 self-source exemption: the checker does not flag its own scope-note description of the four form-3 shapes', () => {
  const { root, cleanup } = cloneRealRepo('self-non-matching-form3');
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.doesNotMatch(
      result.combined, /check-workspace-refs\.mjs:\d+:.*task-workspace prose citation/,
      'the checker must never cite its own source as a form-3 finding site'
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// False-positive guards: each of these targets a specific over-broad-matching
// risk found while designing this checker against this repo's real content.
// ---------------------------------------------------------------------------

test('false-positive guard: a basename that also exists as a tracked file elsewhere is not flagged as a bare workspace reference', () => {
  const { root, cleanup } = buildSyntheticRoot(
    'shared-basename',
    ['node_modules/', 'planning-scratch/'],
    {
      // Tracked (shipped) copy of the shared basename.
      'docs/shared-name.md': 'The tracked, shipped copy of this basename.\n',
      // A same-named file that ALSO happens to sit under the gitignored directory.
      'planning-scratch/shared-name.md': 'A coincidentally same-named scratch file.\n',
      // A bare mention of the basename elsewhere: must not be flagged, because the
      // basename does not exist ONLY under the gitignored directory.
      'docs/mentions-it.md': 'See shared-name.md for background.\n',
    }
  );
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a basename tracked elsewhere must not be treated as workspace-only; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('false-positive guard: a bare directory-name mention with no trailing path segment is not flagged', () => {
  const { root, cleanup } = buildSyntheticRoot(
    'bare-dirname',
    ['node_modules/', 'planning-scratch/'],
    {
      'docs/example.md': 'The planning-scratch directory holds working notes and is not shipped.\n',
    }
  );
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a bare directory name with nothing after it must not be flagged; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('category exclusion: a runtime-artifact-shaped gitignored directory (matching .claude/agent-memory/) is not flagged', () => {
  // .claude/agent-memory/ is a real entry in this repo's own .gitignore, gitignored
  // because it holds a per-project runtime cache the platform itself creates when an
  // agent runs with `memory: project` (see the exclusion's header comment in the
  // checker for the full reasoning and the real shipped-doc sites this was checked
  // against). Declaring the identical string in a synthetic .gitignore here proves the
  // exclusion is keyed to the directory name, independent of which .gitignore declares
  // it.
  const { root, cleanup } = buildSyntheticRoot(
    'agent-memory-shaped',
    ['node_modules/', '.claude/agent-memory/'],
    {
      'docs/example.md': 'The agent keeps its cache at .claude/agent-memory/some-agent-name/ inside your project.\n',
    }
  );
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a runtime-artifact-category directory must not be flagged even though it is gitignored; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Self-non-matching: the checker must not flag its own source or its own
// test file when they are present in the scanned tree.
// ---------------------------------------------------------------------------

test('self-non-matching: the checker does not cite its own source or its own test file as a finding site', () => {
  const { root, cleanup } = cloneRealRepo('self-non-matching');
  try {
    copyFromRepo(root, TEST_FILE_REL);

    const result = runClonedChecker(root, SCRIPT);

    assert.doesNotMatch(result.combined, /check-workspace-refs\.mjs:\d+:/, 'the checker must never cite its own source as a finding site');
    assert.doesNotMatch(result.combined, /check-workspace-refs\.test\.mjs:\d+:/, 'the checker must never cite its own test file as a finding site');
  } finally {
    cleanup();
  }
});
