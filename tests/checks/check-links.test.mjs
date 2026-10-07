// tests/checks/check-links.test.mjs
// what-it-is:   coverage test for scripts/check-links.mjs's handling of .claude/CLAUDE.md
// what-it-does: (1) proves the real tree still passes once .claude/CLAUDE.md is in the scanned
//               set; (2) plants a broken relative link inside .claude/CLAUDE.md and proves it is
//               named in the findings, by file path and line number - the gap this test exists to
//               close, since the checker previously scanned only root-level .md files and the
//               docs/ subtree and silently skipped every hidden directory, including .claude/.
// why:          the coding-agent guide moved from CLAUDE.md (repo root) to .claude/CLAUDE.md so a
//               CLAUDE.md at the plugin root would stop tripping `claude plugin validate
//               --strict`, but the link checker's scan scope was never updated to follow it; a
//               broken relative link inside the moved file was invisible to CI and was found and
//               fixed by hand instead.
// runner:       node --test "tests/checks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone } from './clone-helper.mjs';

const SCRIPT = 'scripts/check-links.mjs';
const CLAUDE_MD = '.claude/CLAUDE.md';

after(() => {
  cleanupGoldenClone();
});

/** Applies fn to a file's text and asserts the edit changed something. */
function mutate(root, rel, fn) {
  const path = join(root, ...rel.split('/'));
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  assert.notEqual(after, before, 'the mutation must change ' + rel);
  writeFileSync(path, after);
}

test('real repo: passes, with .claude/CLAUDE.md included in the scanned set', () => {
  const { root, cleanup } = cloneRepoToTemp('links-clean');
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, result.combined);
  } finally {
    cleanup();
  }
});

test('mutation proof: a broken relative link planted in .claude/CLAUDE.md is named', () => {
  const { root, cleanup } = cloneRepoToTemp('links-claude-broken');
  try {
    mutate(root, CLAUDE_MD, (t) =>
      t.replace('[README.md](../README.md)', '[README.md](../NO-SUCH-FILE.md)'));
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /\.claude[\\/]CLAUDE\.md:\d+: broken link/);
    assert.match(result.combined, /NO-SUCH-FILE\.md/);
  } finally {
    cleanup();
  }
});
