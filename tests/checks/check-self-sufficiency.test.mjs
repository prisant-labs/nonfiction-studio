// tests/checks/check-self-sufficiency.test.mjs
// what-it-is:   planted-violation tests for scripts/check-self-sufficiency.mjs
// what-it-does: runs the real checker script (a standalone script, invoked directly - never
//               through scripts/lib/registry.mjs's check(ctx) pattern) against temp clones of
//               the tracked tree, with a violation planted into the clone only. Covers the
//               ANTHROPIC_API_KEY class (waivable only via scripts/self-sufficiency-exceptions.json)
//               and the non-Anthropic provider-key class (never waivable) both in the
//               pre-existing scan scope and in examples/, which F7 (scan-set blind spots) added
//               to the scanned set; and proves the narrowed carve-out still exempts raw network
//               calls under examples/ (the carve-out that was, and remains, actually justified by
//               "a sample book legitimately contains prose about sources and URLs").
// why:          F6 (checker negative tests) - "a checker that cannot fail is not a checker";
//               F7 (scan-set blind spots) - examples/ needs a test proving it is genuinely
//               scanned for provider-key patterns now, not just declared scanned.
// runner:       node --test "tests/checks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, snapshotPaths, diffPathSnapshots } from './clone-helper.mjs';

const SCRIPT = 'scripts/check-self-sufficiency.mjs';

after(() => {
  cleanupGoldenClone();
});

// ---------------------------------------------------------------------------
// Working-tree-untouched proof, matching check-plugin-root.test.mjs's
// content-hash-snapshot pattern (see clone-helper.mjs's header comment for
// why a whole-tree snapshot and a `git status` check both give false
// positives in this wave's actively shared tree). Scoped to exactly the
// live-repo paths this file's plant steps target (all of them new,
// hence-never-tracked files).
// ---------------------------------------------------------------------------

const WATCHED_LIVE_PATHS = [
  'scripts/_f6-planted-anthropic-key.mjs', // must never come into existence live
  'scripts/_f6-planted-openai-key.mjs',
  'examples/_f6-planted-openai-key.md',
  'examples/_f6-planted-network-mention.md',
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
// Baseline
// ---------------------------------------------------------------------------

test('clean clone: an unmodified temp clone (widened scope included) still exits 0', () => {
  const { root, cleanup } = cloneRepoToTemp('selfsuff-clean');
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'must exit 0 on a clean clone; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Pre-existing scan scope: bin/, hooks/, scripts/, agents/, skills/,
// templates/, docs/, .github/workflows/, tests/, evals/, .claude-plugin/,
// .codex-plugin/, and root-level files were already scanned before F7.
// ---------------------------------------------------------------------------

test('pre-existing scope: an ANTHROPIC_API_KEY reference with no exceptions-file entry is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('selfsuff-anthropic-key');
  try {
    const target = join(root, 'scripts', '_f6-planted-anthropic-key.mjs');
    writeFileSync(target, "const key = process.env.ANTHROPIC_API_KEY;\n");

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /scripts\/_f6-planted-anthropic-key\.mjs/, 'message must name the planted file');
    assert.match(result.combined, /ANTHROPIC_API_KEY/, 'message must name the planted pattern');
    assert.match(result.combined, /no exceptions-file entry/, 'message must say why it is forbidden');
  } finally {
    cleanup();
  }
});

test('pre-existing scope: a non-Anthropic provider key is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('selfsuff-openai-key-preexisting');
  try {
    const target = join(root, 'scripts', '_f6-planted-openai-key.mjs');
    writeFileSync(target, "const key = process.env.OPENAI_API_KEY;\n");

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /scripts\/_f6-planted-openai-key\.mjs/, 'message must name the planted file');
    assert.match(result.combined, /OPENAI_API_KEY/, 'message must name the planted pattern');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Widened scan scope (F7 (scan-set blind spots)): examples/ was not scanned at
// all before F7. A green result here is proof the widening genuinely covers
// examples/ for provider-key patterns, not just that the checker still works
// somewhere it always worked.
// ---------------------------------------------------------------------------

test('widened scope: a non-Anthropic provider key planted under examples/ is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('selfsuff-openai-key-examples');
  try {
    const target = join(root, 'examples', '_f6-planted-openai-key.md');
    writeFileSync(target, 'Planted for F6/F7: OPENAI_API_KEY should never appear in shipped or example content.\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /examples\/_f6-planted-openai-key\.md/, 'message must name the planted file');
    assert.match(result.combined, /OPENAI_API_KEY/, 'message must name the planted pattern');
  } finally {
    cleanup();
  }
});

test('widened scope: a raw network call planted under examples/ remains exempt (narrowed carve-out preserved)', () => {
  const { root, cleanup } = cloneRepoToTemp('selfsuff-network-examples');
  try {
    const target = join(root, 'examples', '_f6-planted-network-mention.md');
    writeFileSync(target, "This chapter's example code calls fetch(url) to illustrate the API the memoirist built.\n");

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 0, 'network patterns must remain exempt under examples/; got: ' + result.combined);
  } finally {
    cleanup();
  }
});
