// tests/checks/check-agent-guide-mirror.test.mjs
// what-it-is:   planted-violation tests for scripts/checks/check-agent-guide-mirror.mjs
// what-it-does: (1) runs the checker against a temp clone of the real tree and proves it passes,
//               tolerating the two known, deliberate differences between AGENTS.md and
//               .claude/CLAUDE.md (the header, and the ../ prefix on relative link targets);
//               (2) plants a one-word divergence in each file's body in turn and proves each is
//               named, with both files' line numbers in the message; (3) proves, with a minimal
//               fixture pair, that the ../ link-prefix difference alone is never flagged, while a
//               genuine (non-prefix) link-target divergence still is; (4) proves a missing anchor
//               line is an operational error (exit 2), not a silent pass or a named finding.
// why:          AGENTS.md says it mirrors .claude/CLAUDE.md and that the two "must change
//               together," but nothing checked that until this script existed - a policy
//               asserted in prose and enforced by nothing is not a control.
// runner:       node --test "tests/checks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, REPO_ROOT } from './clone-helper.mjs';

const SCRIPT = 'scripts/checks/check-agent-guide-mirror.mjs';
const CLAUDE_MD = '.claude/CLAUDE.md';
const AGENTS_MD = 'AGENTS.md';
const ANCHOR = 'Operating guide for AI coding agents (and humans) working IN this repository - the\n';

after(() => {
  cleanupGoldenClone();
});

/** Copies a repo-relative file from the real, current working tree into a clone root. */
function copyFromRepo(root, rel) {
  const dst = join(root, ...rel.split('/'));
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, readFileSync(join(REPO_ROOT, ...rel.split('/'))));
}

function withClone(label, body) {
  const { root, cleanup } = cloneRepoToTemp(label);
  // The checker under test is new; copy it from the live working tree directly rather than
  // relying on it being staged in git's index, matching the sibling checker test files'
  // established discipline (see check-skill-versions.test.mjs's withClone).
  copyFromRepo(root, SCRIPT);
  try {
    body(root);
  } finally {
    cleanup();
  }
}

/** Applies fn to a file's text and asserts the edit changed something. */
function mutate(root, rel, fn) {
  const path = join(root, ...rel.split('/'));
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  assert.notEqual(after, before, 'the mutation must change ' + rel);
  writeFileSync(path, after);
}

// ---------------------------------------------------------------------------
// 1. The real tree.
// ---------------------------------------------------------------------------

test('real repo: the mirror check passes, tolerating the header and the ../ link-prefix difference', () => {
  withClone('mirror-clean', (root) => {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, result.combined);
    assert.match(result.combined, /PASS/);
  });
});

// ---------------------------------------------------------------------------
// 2. Planted divergences in each file's body.
// ---------------------------------------------------------------------------

test('mutation proof: a one-word divergence planted in AGENTS.md body is flagged', () => {
  withClone('mirror-agents-diverge', (root) => {
    mutate(root, AGENTS_MD, (t) =>
      t.replace('Operating guide for AI coding agents', 'Operating guide for AI robot agents'));
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /AGENTS\.md:\d+/);
    assert.match(result.combined, /\.claude[\\/]CLAUDE\.md:\d+/);
  });
});

test('mutation proof: a divergence planted in .claude/CLAUDE.md body is flagged', () => {
  withClone('mirror-claude-diverge', (root) => {
    mutate(root, CLAUDE_MD, (t) =>
      t.replace("plugin's own source tree", "plugin's OWN source tree"));
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /AGENTS\.md:\d+/);
    assert.match(result.combined, /\.claude[\\/]CLAUDE\.md:\d+/);
  });
});

// ---------------------------------------------------------------------------
// 3. Minimal fixture pair isolating the link-prefix normalization rule.
// ---------------------------------------------------------------------------

function writeMinimalPair(root, claudeLinkTarget, agentsLinkTarget) {
  const claudeBody = ANCHOR + 'See [README.md](' + claudeLinkTarget + ') for details.\n';
  const agentsBody = ANCHOR + 'See [README.md](' + agentsLinkTarget + ') for details.\n';
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'CLAUDE.md'), '# CLAUDE.md\n\n' + claudeBody);
  writeFileSync(join(root, 'AGENTS.md'),
    '# AGENTS.md\n\n' +
    'This file mirrors [.claude/CLAUDE.md](.claude/CLAUDE.md); the two must change together.\n\n' +
    agentsBody);
}

test('the known ../ link-prefix difference alone is never flagged (minimal fixture pair)', () => {
  withClone('mirror-prefix-only', (root) => {
    writeMinimalPair(root, '../README.md', 'README.md');
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, result.combined);
  });
});

test('mutation proof: a genuine (non-prefix) link-target divergence is still flagged', () => {
  withClone('mirror-link-divergence', (root) => {
    writeMinimalPair(root, '../OTHER.md', 'README.md');
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, result.combined);
  });
});

// ---------------------------------------------------------------------------
// 4. Operational errors.
// ---------------------------------------------------------------------------

test('operational error: a missing anchor line in .claude/CLAUDE.md is exit 2', () => {
  withClone('mirror-no-anchor', (root) => {
    mutate(root, CLAUDE_MD, (t) => t.replace(ANCHOR.trimEnd(), 'Something else entirely'));
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 2, result.combined);
  });
});

test('operational error: a missing .claude/CLAUDE.md file is exit 2', () => {
  withClone('mirror-no-file', (root) => {
    rmSync(join(root, CLAUDE_MD.split('/').join('/')), { force: true });
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 2, result.combined);
  });
});
