// tests/checks/check-plugin-root.test.mjs
// what-it-is:   planted-violation tests for scripts/checks/check-plugin-root.mjs
// what-it-does: runs the real checker script (a standalone process, not a check(ctx) module -
//               see scripts/lib/registry.mjs's CHECKS array, which does not include it) against
//               temp clones of the tracked tree, with a violation planted into the clone only.
//               Covers both finding types (relative bin invocation, literal plugin-root
//               environment-variable string) in both the pre-existing scan scope
//               (skills/**/SKILL.md, agents/*.md) and the widened scan scope (README.md,
//               docs/formats/**, examples/**), plus a false-positive regression: the real
//               hooks.json-shaped probe files under examples/spikes/ carry the braced
//               plugin-root form as their correct, required syntax and must not be flagged.
// why:          F6 (checker negative tests) - "a checker that cannot fail is not a checker";
//               F7 (scan-set blind spots) - the widened areas need a test proving they are
//               genuinely covered, not just declared covered.
// runner:       node --test "tests/checks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, snapshotPaths, diffPathSnapshots } from './clone-helper.mjs';

const SCRIPT = 'scripts/checks/check-plugin-root.mjs';

after(() => {
  cleanupGoldenClone();
});

// ---------------------------------------------------------------------------
// Working-tree-untouched proof (test-fixtures.mjs's temp-clone discipline,
// applied to this file's clones): content-hash every live-repo path this
// file's tests plant into (the only paths this file's code could possibly
// leak a write into) before any test runs, and again once every test has
// run; the two snapshots must match. Scoped to exactly that path list, not
// the whole tree (a concurrent task's unrelated commit elsewhere must not
// fail this file), and compared against a same-session snapshot, not `git
// status` against HEAD (a watched path can already legitimately carry an
// uncommitted edit from earlier, unrelated work -- skills/draft-chapter/
// SKILL.md carries this task's own F4 (verb vocabulary) edit). Registered as
// `after()` so it runs regardless of which tests passed or failed, and
// regardless of node:test's concurrency scheduling above.
// ---------------------------------------------------------------------------

const WATCHED_LIVE_PATHS = [
  'skills/draft-chapter/SKILL.md',
  'agents/voice-capture.md',
  'README.md',
  'docs/formats/decisions.md',
  'examples/_f6-planted-violation.md', // must never come into existence live
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
// Pre-existing scan scope: skills/**/SKILL.md and agents/*.md were already in
// scope before F7 (scan-set blind spots); these two tests are the "checker
// can fail" baseline, independent of the widening below.
// ---------------------------------------------------------------------------

test('pre-existing scope: a relative "node bin/ns-*" invocation planted in a SKILL.md is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('plugin-root-skill');
  try {
    const target = join(root, 'skills', 'draft-chapter', 'SKILL.md');
    appendFileSync(target, '\nPlanted for F6: run `node bin/ns-claims --project=.` directly.\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /skills\/draft-chapter\/SKILL\.md/, 'message must name the planted file');
    assert.match(result.combined, /relative bin invocation/, 'message must name the violation type');
  } finally {
    cleanup();
  }
});

test('pre-existing scope: a literal ${CLAUDE_PLUGIN_ROOT} string planted in a top-level agent file is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('plugin-root-agent');
  try {
    const target = join(root, 'agents', 'voice-capture.md');
    appendFileSync(target, '\nPlanted for F6: never write the literal string ' + '${CLAUDE_PLUGIN_ROOT}' + ' in prose.\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /agents\/voice-capture\.md/, 'message must name the planted file');
    assert.match(result.combined, /literal plugin-root environment-variable string/, 'message must name the violation type');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Widened scan scope (F7 (scan-set blind spots)): README.md, docs/formats/**,
// and examples/** were NOT scanned before F7. Each test here plants a
// violation strictly inside one of the three newly-covered areas, so a green
// result here is proof the widening genuinely covers that area, not just
// that the checker still works somewhere it always worked.
// ---------------------------------------------------------------------------

test('widened scope: a relative "node bin/ns-*" invocation planted in README.md is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('plugin-root-readme');
  try {
    const target = join(root, 'README.md');
    appendFileSync(target, '\nPlanted for F6/F7: run `node bin/ns-doctor --check` directly.\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /README\.md/, 'message must name the planted file');
    assert.match(result.combined, /relative bin invocation/, 'message must name the violation type');
  } finally {
    cleanup();
  }
});

test('widened scope: a literal ${CLAUDE_PLUGIN_ROOT} string planted in docs/formats/ is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('plugin-root-docs-formats');
  try {
    const target = join(root, 'docs', 'formats', 'decisions.md');
    appendFileSync(target, '\nPlanted for F6/F7: never write the literal string ' + '${CLAUDE_PLUGIN_ROOT}' + ' in prose.\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /docs\/formats\/decisions\.md/, 'message must name the planted file');
    assert.match(result.combined, /literal plugin-root environment-variable string/, 'message must name the violation type');
  } finally {
    cleanup();
  }
});

test('widened scope: a literal ${CLAUDE_PLUGIN_ROOT} string planted under examples/ is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('plugin-root-examples');
  try {
    const target = join(root, 'examples', '_f6-planted-violation.md');
    writeFileSync(target, 'Planted for F6/F7: never write the literal string ' + '${CLAUDE_PLUGIN_ROOT}' + ' in prose.\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /examples\/_f6-planted-violation\.md/, 'message must name the planted file');
    assert.match(result.combined, /literal plugin-root environment-variable string/, 'message must name the violation type');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// False-positive regression: examples/spikes/ carries real hooks.json-shaped
// probe files (hooks.json, hooks.form-a-wrapper.json, hooks.form-b-flat.json)
// whose "command" strings legitimately use the braced plugin-root form -- the
// exact same syntax hooks/hooks.json itself requires. A fully unmodified
// clone must still exit 0 even though examples/ is now in scope and contains
// them.
// ---------------------------------------------------------------------------

test('clean clone: an unmodified temp clone (widened scope included) still exits 0', () => {
  const { root, cleanup } = cloneRepoToTemp('plugin-root-clean');
  try {
    // Sanity: the known hooks.json-shaped probe files are actually present in
    // the clone, so a pass here is not a pass-by-absence.
    const probe = readFileSync(join(root, 'examples', 'spikes', 'spk-01', 'hooks.form-a-wrapper.json'), 'utf8');
    assert.match(probe, /CLAUDE_PLUGIN_ROOT/, 'fixture assumption: the probe file must actually contain the braced form');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 0, 'must exit 0 on a clean clone; got: ' + result.combined);
  } finally {
    cleanup();
  }
});
