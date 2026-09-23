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
//               never coupled to staging order during iteration. The checker now also requires a
//               committed manifest (workspace-refs-manifest.json, next to the script) to be
//               present, so buildSyntheticRoot always writes one too (empty by default, or a
//               caller-supplied hash set), and cloneRealRepo copies the real one the same way it
//               copies the script itself.
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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, snapshotPaths, diffPathSnapshots, REPO_ROOT } from './clone-helper.mjs';

const SCRIPT = 'scripts/checks/check-workspace-refs.mjs';
const TEST_FILE_REL = 'tests/checks/check-workspace-refs.test.mjs';
const MANIFEST_REL = 'scripts/checks/workspace-refs-manifest.json';

function sha256Hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

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

/** Writes a manifest fixture ({ version: 1, algorithm: "sha256", hashes: [...] }) into a
 *  fixture root at the real manifest's path, so the checker (which fatals on a missing or
 *  malformed manifest - see this checker's header) always has one to read. Defaults to an
 *  empty hash set: a fixture that needs specific manifest-only hashes passes them explicitly. */
function writeManifestFixture(root, hashes = []) {
  const dst = join(root, ...MANIFEST_REL.split('/'));
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, JSON.stringify({ version: 1, algorithm: 'sha256', hashes: [...hashes].sort() }, null, 2) + '\n');
}

/**
 * Builds a from-scratch temp directory carrying its own .gitignore and shipped
 * files, plus a fresh copy of this repo's CURRENT on-disk checker script and a
 * manifest fixture (empty by default; pass manifestHashes for a test that needs
 * a specific committed-manifest hash with no corresponding live scratch file).
 * Not derived from the real tracked tree at all, so assertions here are never
 * contaminated by anything already present in this repo.
 */
function buildSyntheticRoot(label, gitignoreLines, files, manifestHashes = []) {
  const root = mkdtempSync(join(tmpdir(), 'nonfiction-workspace-refs-synth-' + label + '-'));
  writeFileSync(join(root, '.gitignore'), gitignoreLines.join('\n') + '\n');
  copyFromRepo(root, SCRIPT);
  writeManifestFixture(root, manifestHashes);
  for (const [relPath, content] of Object.entries(files)) {
    const dst = join(root, ...relPath.split('/'));
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, content);
  }
  return { root, cleanup: () => safeRemove(root) };
}

/** cloneRepoToTemp, but with this repo's CURRENT on-disk checker script AND manifest copied
 *  over whatever the git-tracked snapshot provided, so tests never depend on either being
 *  staged. */
function cloneRealRepo(label) {
  const { root, cleanup } = cloneRepoToTemp(label);
  copyFromRepo(root, SCRIPT);
  copyFromRepo(root, MANIFEST_REL);
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
  'docs/_fixture-clean-clone-mutation.md',
  'docs/_fixture-tracked-subtraction.md',
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

// ---------------------------------------------------------------------------
// Manifest-backed hashed matching: form 2's forbidden-basename set now comes
// from a committed, hashed manifest (unioned with a live scratch-tree walk
// when one exists), matched via token extraction plus hashing rather than a
// literal alternation regex, so a clean CI checkout (no scratch tree at all)
// still enforces the bare-filename form. Fixture basenames throughout this
// section are entirely invented; none of them, hashed or in clear text, name
// anything that exists on this machine.
// ---------------------------------------------------------------------------

/** Extracts "lineNo:matchedText" pairs from a checker run's combined output, for form 2
 *  ("bare workspace filename reference") findings only - form 1 and form 3 findings use a
 *  different message shape and are not captured here. */
function extractForm2Findings(combinedOutput) {
  const re = /[^\s:]+:(\d+): bare workspace filename reference "([^"]+)"/g;
  const out = [];
  let m;
  while ((m = re.exec(combinedOutput)) !== null) {
    out.push(m[1] + ':' + m[2]);
  }
  return out.sort();
}

/** A direct re-implementation of the pre-hash literal alternation regex (escape, sort by
 *  descending length, lookbehind/lookahead), used ONLY as a parity oracle in this test file -
 *  never shipped. Runs against caller-supplied text and a caller-supplied basename list, so it
 *  never depends on this repo's own real scratch tree. */
function referenceLiteralForm2Matches(text, basenames) {
  if (basenames.length === 0) return [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alternation = basenames.map(esc).sort((a, b) => b.length - a.length).join('|');
  const re = new RegExp('(?<![A-Za-z0-9_./-])(' + alternation + ')(?![A-Za-z0-9_-])', 'g');
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      out.push((i + 1) + ':' + m[1]);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return out.sort();
}

test('parity: the hashed token matcher and the literal alternation regex agree on every boundary case (trailing-period, slash-preceded, prefix-of-longer-token, overlapping-basename, lookahead-negative, dotless)', () => {
  const forbidden = [
    'alpha-thing.md',
    'alpha-thing.md.bak',
    'beta-notes.txt',
    'gamma-record.csv',
    'epsilon-file.json',
    'zetaitem',
  ];
  const corpusLines = [
    'Combined alpha-thing.md.bak should match only as the longer entry.',              // overlapping-basename
    'Standing alone, alpha-thing.md is also independently flagged.',                    // shorter alone
    'Trailing sentence example: beta-notes.txt.',                                       // trailing-period
    'See widget-scratch/gamma-record.csv for the slash-preceded case.',                 // slash-preceded (no match)
    'A longer suffix example: epsilon-file.json.old provides a snapshot.',              // prefix-of-longer-token
    'Extension variant example: alpha-thing.mdx should never match.',                   // lookahead-negative (letter)
    'Hyphen suffix example: alpha-thing.md-old should never match.',                    // lookahead-negative (hyphen)
    'Prefixed example: xalpha-thing.md should never match on its own.',                 // lookbehind-negative (non-slash)
    'Dotless example: zetaitem should still match.',                                    // dotless full-token
  ];
  const corpusText = corpusLines.join('\n') + '\n';

  const files = { 'docs/parity-corpus.md': corpusText };
  for (const name of forbidden) {
    files['widget-scratch/' + name] = 'fixture placeholder\n';
  }

  const { root, cleanup } = buildSyntheticRoot('parity', ['node_modules/', 'widget-scratch/'], files);
  try {
    const result = runClonedChecker(root, SCRIPT);
    const actual = extractForm2Findings(result.combined);
    const expectedOracle = referenceLiteralForm2Matches(corpusText, forbidden);

    assert.ok(expectedOracle.length > 0, 'the oracle itself must not be vacuous');
    assert.deepEqual(actual, expectedOracle, 'the hashed matcher and the literal-regex oracle must find identical findings; got: ' + result.combined);

    // Pin the exact expected set by hand too, so a bug shared by both implementations cannot
    // mask a regression that a pure oracle-equality check would miss.
    assert.deepEqual(actual, [
      '1:alpha-thing.md.bak',
      '2:alpha-thing.md',
      '3:beta-notes.txt',
      '5:epsilon-file.json',
      '9:zetaitem',
    ]);
  } finally {
    cleanup();
  }
});

test('non-token-shaped basename (one containing a space) stays live-derived only, and --write-manifest reports it as skipped', () => {
  const invented = 'fixture notes draft.md';
  const files = {
    'docs/example.md': 'See ' + invented + ' for the source list.\n',
  };
  files['planning-scratch/' + invented] = 'A fixture whose name is not token-shaped.\n';

  const { root, cleanup } = buildSyntheticRoot('nontoken', ['node_modules/', 'planning-scratch/'], files);
  try {
    const scanResult = runClonedChecker(root, SCRIPT);
    assert.equal(scanResult.status, 1, 'the live-derived literal-regex fallback must still catch a non-token-shaped basename locally; got: ' + scanResult.combined);
    assert.match(scanResult.combined, /bare workspace filename reference "fixture notes draft\.md"/);

    const writeResult = runClonedChecker(root, SCRIPT, ['--write-manifest']);
    assert.equal(writeResult.status, 0, 'got: ' + writeResult.combined);
    assert.match(writeResult.combined, /1 skipped: non-token-shaped/);

    const manifestPath = join(root, ...MANIFEST_REL.split('/'));
    const written = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const inventedHash = sha256Hex(invented);
    assert.ok(!written.hashes.includes(inventedHash), 'a non-token-shaped basename must never be written to the manifest');
  } finally {
    cleanup();
  }
});

test('clean-clone mutation proof: a manifest-listed name is caught with no scratch dirs on disk, and clears once removed from the manifest', () => {
  const { root, cleanup } = cloneRealRepo('clean-clone-mutation');
  try {
    const markerName = 'zzz-fixture-marker-9231.md';
    const markerHash = sha256Hex(markerName);
    const manifestPath = join(root, ...MANIFEST_REL.split('/'));
    writeFileSync(manifestPath, JSON.stringify({ version: 1, algorithm: 'sha256', hashes: [markerHash] }, null, 2) + '\n');

    const target = join(root, 'docs', '_fixture-clean-clone-mutation.md');
    writeFileSync(target, 'See ' + markerName + ' for details.\n');

    const red = runClonedChecker(root, SCRIPT);
    assert.equal(red.status, 1, 'must exit 1 when the manifest lists the matched name with no scratch dirs present; got: ' + red.combined);
    assert.match(red.combined, /bare workspace filename reference "zzz-fixture-marker-9231\.md"/);
    assert.match(red.combined, /matches the committed workspace-refs manifest/);

    writeFileSync(manifestPath, JSON.stringify({ version: 1, algorithm: 'sha256', hashes: [] }, null, 2) + '\n');
    const green = runClonedChecker(root, SCRIPT);
    assert.equal(green.status, 0, 'must exit 0 once the hash is removed from the manifest, with no scratch dirs present either time; got: ' + green.combined);
  } finally {
    cleanup();
  }
});

test('freshness: a live-derived scratch basename not yet in the committed manifest prints a NOTICE and still exits 0', () => {
  const { root, cleanup } = cloneRealRepo('freshness-notice');
  try {
    // Assembled from separate parts per this file's self-matching discipline (see header): this
    // test runs against a real-repo clone that includes this very test file's on-disk source, so
    // a contiguous literal here would be a genuine, self-inflicted live-derived match once this
    // basename becomes a real scratch file inside the clone below.
    const freshName = 'fixture-fresh-name-' + '4471' + '.md';
    const scratchFile = join(root, '_local', '_fixture-freshness', freshName);
    mkdirSync(dirname(scratchFile), { recursive: true });
    writeFileSync(scratchFile, 'Fixture-only scratch content, never referenced elsewhere.\n');

    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'an unreferenced fresh scratch basename must not fail the run; got: ' + result.combined);
    assert.match(result.combined, /NOTICE: 1 scratch basename\(s\) not in the committed manifest; run with --write-manifest/);
  } finally {
    cleanup();
  }
});

test('--write-manifest is byte-stable across repeated runs and preserves a pre-existing hash whose file is absent', () => {
  const { root, cleanup } = cloneRealRepo('write-manifest-stable');
  try {
    const manifestPath = join(root, ...MANIFEST_REL.split('/'));
    const before = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const staleHash = sha256Hex('fixture-vanished-name-8820.md');
    writeFileSync(manifestPath, JSON.stringify({ version: 1, algorithm: 'sha256', hashes: [...before.hashes, staleHash].sort() }, null, 2) + '\n');

    const first = runClonedChecker(root, SCRIPT, ['--write-manifest']);
    assert.equal(first.status, 0, 'got: ' + first.combined);
    const afterFirst = readFileSync(manifestPath, 'utf8');

    const second = runClonedChecker(root, SCRIPT, ['--write-manifest']);
    assert.equal(second.status, 0, 'got: ' + second.combined);
    const afterSecond = readFileSync(manifestPath, 'utf8');

    assert.equal(afterFirst, afterSecond, 'running --write-manifest twice in a row must be byte-identical (a no-op the second time)');
    assert.ok(afterSecond.endsWith('\n'), 'must end with a trailing newline');

    const finalData = JSON.parse(afterSecond);
    assert.ok(finalData.hashes.includes(staleHash), 'a pre-existing hash whose scratch file no longer exists must survive the union, never auto-pruned');
  } finally {
    cleanup();
  }
});

test('tracked-basename subtraction: a manifest hash equal to a tracked basename never flags', () => {
  const { root, cleanup } = cloneRealRepo('tracked-subtraction');
  try {
    const trackedName = 'CHANGELOG.md';
    const trackedHash = sha256Hex(trackedName);
    const manifestPath = join(root, ...MANIFEST_REL.split('/'));
    writeFileSync(manifestPath, JSON.stringify({ version: 1, algorithm: 'sha256', hashes: [trackedHash] }, null, 2) + '\n');

    const target = join(root, 'docs', '_fixture-tracked-subtraction.md');
    writeFileSync(target, 'See ' + trackedName + ' for the full history.\n');

    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a manifest hash equal to a tracked basename must never flag; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('a checkout with no manifest file fails loudly (exit 2), not a silent pass', () => {
  const { root, cleanup } = buildSyntheticRoot('no-manifest', ['node_modules/'], {
    'docs/example.md': 'Ordinary prose with nothing gitignored-related.\n',
  });
  try {
    rmSync(join(root, ...MANIFEST_REL.split('/')), { force: true });
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 2, 'a missing manifest must be an operational error, not a silent pass; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('a malformed manifest entry (non-hex) fails loudly (exit 2)', () => {
  const { root, cleanup } = buildSyntheticRoot('malformed-manifest', ['node_modules/'], {
    'docs/example.md': 'Ordinary prose with nothing gitignored-related.\n',
  });
  try {
    writeFileSync(
      join(root, ...MANIFEST_REL.split('/')),
      JSON.stringify({ version: 1, algorithm: 'sha256', hashes: ['not-a-hex-digest'] }, null, 2) + '\n'
    );
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 2, 'a malformed manifest entry must be an operational error; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('--write-manifest mode: a missing manifest file starts from an empty set (not a fatal), reports so, and writes one', () => {
  const { root, cleanup } = buildSyntheticRoot('write-no-manifest', ['node_modules/'], {
    'docs/example.md': 'Ordinary prose with nothing gitignored-related.\n',
  });
  try {
    const manifestPath = join(root, ...MANIFEST_REL.split('/'));
    rmSync(manifestPath, { force: true });

    const result = runClonedChecker(root, SCRIPT, ['--write-manifest']);
    assert.equal(result.status, 0, '--write-manifest must tolerate a missing file, not fatal; got: ' + result.combined);
    assert.match(result.combined, /no existing manifest at .*; starting from an empty set/);

    const written = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(written, { version: 1, algorithm: 'sha256', hashes: [] });
  } finally {
    cleanup();
  }
});

test('--write-manifest mode: a malformed manifest entry (non-hex) is still fatal (exit 2), never silently overwritten', () => {
  const { root, cleanup } = buildSyntheticRoot('write-malformed-manifest', ['node_modules/'], {
    'docs/example.md': 'Ordinary prose with nothing gitignored-related.\n',
  });
  try {
    const manifestPath = join(root, ...MANIFEST_REL.split('/'));
    writeFileSync(manifestPath, JSON.stringify({ version: 1, algorithm: 'sha256', hashes: ['not-a-hex-digest'] }, null, 2) + '\n');
    const before = readFileSync(manifestPath, 'utf8');

    const result = runClonedChecker(root, SCRIPT, ['--write-manifest']);
    assert.equal(result.status, 2, 'a malformed manifest entry must stay fatal even in --write-manifest mode; got: ' + result.combined);

    const after = readFileSync(manifestPath, 'utf8');
    assert.equal(after, before, 'a fatal malformed-manifest run must never overwrite the file');
  } finally {
    cleanup();
  }
});

test('committed manifest: every entry is a lowercase hex sha256 digest, never a clear-text basename', () => {
  const manifestPath = join(REPO_ROOT, ...MANIFEST_REL.split('/'));
  const data = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(data.version, 1);
  assert.equal(data.algorithm, 'sha256');
  assert.ok(Array.isArray(data.hashes) && data.hashes.length > 0, 'the committed manifest must not be empty');
  for (const h of data.hashes) {
    assert.match(h, /^[0-9a-f]{64}$/, 'every manifest entry must be a lowercase hex sha256 digest: ' + JSON.stringify(h));
  }
});
