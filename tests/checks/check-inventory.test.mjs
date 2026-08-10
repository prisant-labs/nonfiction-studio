// tests/checks/check-inventory.test.mjs
// what-it-is:   planted-violation tests for scripts/checks/check-inventory.mjs
// what-it-does: runs the real checker script (a standalone process, not a check(ctx) module -
//               see scripts/lib/registry.mjs's CHECKS array, which does not include it) against
//               temp clones of the tracked tree, with a violation planted into the clone only.
//               Covers both of the checker's duties: inventory drift, in both directions (a
//               component on disk that library.json does not declare, and a component
//               library.json declares that does not exist on disk), and manifest name equality
//               (plugin.json's "name" diverging from library.json's).
// why:          F6 (checker negative tests) - "a checker that cannot fail is not a checker".
//               check-inventory.mjs's own design note says its discovery is a plain filesystem
//               read that works "including in a bare directory copy with no .git present at
//               all"; these tests are exactly that bare-copy scenario.
// runner:       node --test "tests/checks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, snapshotPaths, diffPathSnapshots } from './clone-helper.mjs';

const SCRIPT = 'scripts/checks/check-inventory.mjs';

after(() => {
  cleanupGoldenClone();
});

// ---------------------------------------------------------------------------
// Working-tree-untouched proof, matching the other tests/checks/*.test.mjs
// files' content-hash-snapshot pattern (see clone-helper.mjs's header comment
// for why a whole-tree snapshot and a `git status` check both give false
// positives in this wave's actively shared tree). Scoped to exactly the
// live-repo paths this file's plant steps target.
// ---------------------------------------------------------------------------

const WATCHED_LIVE_PATHS = [
  'skills/_f6-planted-skill/SKILL.md', // must never come into existence live
  'agents/thesis-architect.md',
  '.claude-plugin/plugin.json',
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

test('clean clone: check-inventory exits 0 on an unmodified temp clone', () => {
  const { root, cleanup } = cloneRepoToTemp('inventory-clean');
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'must exit 0 on a clean clone; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Duty 1: inventory equality (F-ST-03 (component inventory)), both directions.
// ---------------------------------------------------------------------------

test('inventory drift: a skill directory on disk with no library.json declaration is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('inventory-undeclared-skill');
  try {
    const skillDir = join(root, 'skills', '_f6-planted-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: f6-planted-skill\n---\nPlanted for F6.\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /_f6-planted-skill/, 'message must name the planted skill');
    assert.match(result.combined, /exists in the tree but is not declared in library\.json/, 'message must name the drift direction');
  } finally {
    cleanup();
  }
});

test('inventory drift: library.json declaring a component missing from disk is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('inventory-missing-agent');
  try {
    // thesis-architect is declared in library.json components.agents; delete
    // it from the clone only so the declaration now points at nothing.
    unlinkSync(join(root, 'agents', 'thesis-architect.md'));

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /thesis-architect/, 'message must name the missing component');
    assert.match(result.combined, /library\.json declares .* but it does not exist in the tree/, 'message must name the drift direction');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Duty 2: name equality (F-ST-04 (manifest name equality), ADR-0006 (manifest
// authority split)).
// ---------------------------------------------------------------------------

test('manifest name mismatch: plugin.json name diverging from library.json name is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('inventory-name-mismatch');
  try {
    const pluginJsonPath = join(root, '.claude-plugin', 'plugin.json');
    const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
    pluginJson.name = 'nonfiction-studio-f6-planted-mismatch';
    writeFileSync(pluginJsonPath, JSON.stringify(pluginJson, null, 2) + '\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /nonfiction-studio-f6-planted-mismatch/, 'message must name the planted mismatched value');
    assert.match(result.combined, /does not equal library\.json name/, 'message must name the mismatch');
  } finally {
    cleanup();
  }
});
