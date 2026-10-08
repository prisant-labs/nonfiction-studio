// tests/checks/check-skill-versions.test.mjs
// what-it-is:   tests for scripts/checks/check-skill-versions.mjs, the per-skill versioning checker
//               (ADR-0017, per-skill versioning)
// what-it-does: (1) runs the checker against a temp clone of the real tree (no .git, so degraded
//               mode: R1 to R3) and plants one defect per test - a missing version, a missing
//               metadata map, a missing HISTORY.md, a version that disagrees with the history, rows
//               out of order, an `unreleased` row below the first, an unknown type - proving each is
//               named; (2) builds small throwaway git repositories with a tag to prove R4 (a skill
//               changed since the tag must carry a pending first row) and release mode's R5 (no
//               `unreleased` row survives a tag push); (3) proves the fail-closed rule: under CI=true
//               a checker that cannot see history exits 2 instead of passing.
// runner:       node --test "tests/checks/*.test.mjs" (picked up by scripts/test-engines.mjs)

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, REPO_ROOT } from './clone-helper.mjs';

const SCRIPT = 'scripts/checks/check-skill-versions.mjs';
const HEADER = '| Version | Date | Release | Type | Summary |\n|---|---|---|---|---|\n';

// The checker fails closed under CI=true when it cannot see history. Every test that expects a
// pass in degraded mode runs without CI, so the outcome does not depend on where the suite runs.
const LOCAL_ENV = { ...process.env };
delete LOCAL_ENV.CI;
const CI_ENV = { ...LOCAL_ENV, CI: 'true' };

after(() => {
  cleanupGoldenClone();
});

/** Copies a repo-relative file from the working tree into a target root. */
function copyFromRepo(root, rel) {
  const dst = join(root, ...rel.split('/'));
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, readFileSync(join(REPO_ROOT, ...rel.split('/'))));
}

function withClone(label, body) {
  const { root, cleanup } = cloneRepoToTemp(label);
  copyFromRepo(root, SCRIPT);
  copyFromRepo(root, 'hooks/lib/mini-yaml.mjs');
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
// Synthetic git repositories, for R4 and R5.
// ---------------------------------------------------------------------------

function skillText(name, version, updated, body = 'Body.') {
  return '---\nname: ' + name + '\nuser-invocable: true\nmetadata:\n  version: "' + version + '"\n  updated: ' +
    updated + '\n---\n\n' + body + '\n';
}

/** rows: [version, date, release, type, summary] arrays, newest first. */
function historyText(name, rows) {
  return '# History - ' + name + '\n\n' + HEADER + rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n') + '\n';
}

function writeSkill(root, name, version, updated, rows, body) {
  const dir = join(root, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), skillText(name, version, updated, body));
  writeFileSync(join(dir, 'HISTORY.md'), historyText(name, rows));
}

function gitIn(root, args) {
  return execFileSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', '-c', 'core.autocrlf=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const RELEASED = [['0.1.0', '2026-09-23', 'v0.1.0', 'added', 'First released version.']];

/** A git repository holding the checker and one released skill, committed and tagged v0.1.0. */
function withGitRepo(label, body, { tag = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nonfiction-skill-versions-' + label + '-'));
  try {
    copyFromRepo(root, SCRIPT);
    copyFromRepo(root, 'hooks/lib/mini-yaml.mjs');
    writeSkill(root, 'nfs-alpha', '0.1.0', '2026-09-23', RELEASED);
    gitIn(root, ['init', '-q']);
    gitIn(root, ['add', '-A']);
    gitIn(root, ['commit', '-q', '-m', 'initial']);
    if (tag) gitIn(root, ['tag', 'v0.1.0']);
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The real tree, degraded mode (R1 to R3).
// ---------------------------------------------------------------------------

test('real repo: exits 0 in degraded mode and names every skill with its version', () => {
  withClone('versions-clean', (root) => {
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 0, 'must exit 0 on the real tree; got: ' + result.combined);
    assert.match(result.combined, /mode: degraded/);
    assert.match(result.combined, /PASS: \d+ skill\(s\) versioned: nfs-adopt \d+\.\d+\.\d+/);
  });
});

test('mutation proof (R1): a skill without metadata.version is named', () => {
  withClone('versions-no-version', (root) => {
    mutate(root, 'skills/nfs-draft/SKILL.md', (t) => t.replace(/\n {2}version: "[^"]*"/, ''));
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /skills\/nfs-draft\/SKILL\.md: metadata\.version must be a quoted MAJOR\.MINOR\.PATCH string.*\(R1\)/);
  });
});

test('mutation proof (R1): a skill with no metadata map is named', () => {
  withClone('versions-no-metadata', (root) => {
    mutate(root, 'skills/nfs-tour/SKILL.md', (t) => t.replace(/\nmetadata:\n {2}version: "[^"]*"\n {2}updated: [0-9-]+/, ''));
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /skills\/nfs-tour\/SKILL\.md: frontmatter has no `metadata:` map.*\(R1\)/);
  });
});

test('mutation proof (R2): a skill without HISTORY.md is named', () => {
  withClone('versions-no-history', (root) => {
    rmSync(join(root, 'skills', 'nfs-research', 'HISTORY.md'));
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /skills\/nfs-research\/HISTORY\.md: missing.*\(R2\)/);
  });
});

test('mutation proof (R2): a version bumped in SKILL.md but not in HISTORY.md is named', () => {
  withClone('versions-mismatch', (root) => {
    mutate(root, 'skills/nfs-outline/SKILL.md', (t) => t.replace(/version: "[^"]*"/, 'version: "9.9.9"'));
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /skills\/nfs-outline\/HISTORY\.md:\d+: first row version \S+ differs from SKILL\.md metadata\.version 9\.9\.9 \(R2\)/);
  });
});

test('mutation proof (R3): rows out of order are named', () => {
  withClone('versions-order', (root) => {
    // nfs-doctor has three rows; moving the oldest to the top breaks the descending order.
    mutate(root, 'skills/nfs-doctor/HISTORY.md', (t) => {
      const lines = t.split('\n');
      const rows = lines.map((l, i) => [l, i]).filter(([l]) => /^\| \d/.test(l)).map(([, i]) => i);
      const last = lines.splice(rows[rows.length - 1], 1)[0];
      lines.splice(rows[0], 0, last);
      return lines.join('\n');
    });
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /skills\/nfs-doctor\/HISTORY\.md:\d+: version \S+ is not lower than the row above it.*\(R3\)/);
  });
});

test('mutation proof (R3): an `unreleased` row below the first is named', () => {
  withClone('versions-unreleased-below', (root) => {
    mutate(root, 'skills/nfs-check-chapter/HISTORY.md', (t) => t.replace('| v0.1.1 |', '| unreleased |'));
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /skills\/nfs-check-chapter\/HISTORY\.md:\d+: only the first row may say `unreleased` \(R3\)/);
  });
});

test('mutation proof (R3): an unknown change type is named', () => {
  withClone('versions-type', (root) => {
    mutate(root, 'skills/nfs-start/HISTORY.md', (t) => t.replace('| added |', '| improved |'));
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /skills\/nfs-start\/HISTORY\.md:\d+: type "improved" is not one of.*\(R3\)/);
  });
});

test('fail closed: under CI=true, a tree with no history to read is an operational error (exit 2)', () => {
  withClone('versions-ci-blind', (root) => {
    const result = runClonedChecker(root, SCRIPT, [], CI_ENV);
    assert.equal(result.status, 2, result.combined);
    assert.match(result.combined, /fetch-depth 0/);
  });
});

// ---------------------------------------------------------------------------
// Git mode (R4).
// ---------------------------------------------------------------------------

test('git mode: a skill unchanged since the tag passes', () => {
  withGitRepo('unchanged', (root) => {
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 0, result.combined);
    assert.match(result.combined, /mode: git \(latest tag v0\.1\.0; 0 skill\(s\) changed since it\)/);
  });
});

test('mutation proof (R4): a skill changed since the tag without a new version is named', () => {
  withGitRepo('changed-unbumped', (root) => {
    appendFileSync(join(root, 'skills', 'nfs-alpha', 'SKILL.md'), '\nA new paragraph.\n');
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /nfs-alpha changed since v0\.1\.0 but its newest row \(0\.1\.0\) is already released as v0\.1\.0.*\(R4\)/);
  });
});

test('git mode: a changed skill with an `unreleased` row for its new version passes', () => {
  withGitRepo('changed-bumped', (root) => {
    writeSkill(root, 'nfs-alpha', '0.2.0', '2026-10-04',
      [['0.2.0', '2026-10-04', 'unreleased', 'changed', 'A new paragraph.'], ...RELEASED], 'Body.\n\nA new paragraph.');
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 0, result.combined);
    assert.match(result.combined, /1 skill\(s\) changed since it/);
  });
});

test('git mode: a changed skill already stamped for the next release passes (release preparation)', () => {
  withGitRepo('changed-stamped', (root) => {
    writeSkill(root, 'nfs-alpha', '0.2.0', '2026-10-04',
      [['0.2.0', '2026-10-04', 'v0.2.0', 'changed', 'A new paragraph.'], ...RELEASED], 'Body.\n\nA new paragraph.');
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 0, result.combined);
  });
});

test('mutation proof (R4): a skill added since the tag that claims a released version is named', () => {
  withGitRepo('new-skill', (root) => {
    writeSkill(root, 'nfs-beta', '0.1.0', '2026-09-23', RELEASED);
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /nfs-beta changed since v0\.1\.0.*\(R4\)/);
  });
});

test('mutation proof (R4): an untracked file added to a skill counts as a change', () => {
  withGitRepo('untracked', (root) => {
    writeFileSync(join(root, 'skills', 'nfs-alpha', 'reference.md'), 'New reference material.\n');
    const result = runClonedChecker(root, SCRIPT, [], LOCAL_ENV);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /nfs-alpha changed since v0\.1\.0.*\(R4\)/);
  });
});

test('fail closed: under CI=true, a git repository with no v*.*.* tag is an operational error (exit 2)', () => {
  withGitRepo('no-tag', (root) => {
    const result = runClonedChecker(root, SCRIPT, [], CI_ENV);
    assert.equal(result.status, 2, result.combined);
  }, { tag: false });
});

// ---------------------------------------------------------------------------
// Release mode (R5).
// ---------------------------------------------------------------------------

test('mutation proof (R5): a release with an `unreleased` row left in place is refused', () => {
  withGitRepo('release-unstamped', (root) => {
    writeSkill(root, 'nfs-alpha', '0.2.0', '2026-10-04',
      [['0.2.0', '2026-10-04', 'unreleased', 'changed', 'A new paragraph.'], ...RELEASED]);
    const result = runClonedChecker(root, SCRIPT, ['--release', 'v0.2.0'], CI_ENV);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /still says `unreleased`; stamp it with the release tag before publishing v0\.2\.0 \(R5\)/);
  });
});

test('release mode: every row stamped passes, and needs no history even under CI=true', () => {
  withGitRepo('release-stamped', (root) => {
    writeSkill(root, 'nfs-alpha', '0.2.0', '2026-10-04',
      [['0.2.0', '2026-10-04', 'v0.2.0', 'changed', 'A new paragraph.'], ...RELEASED]);
    const result = runClonedChecker(root, SCRIPT, ['--release', 'v0.2.0'], CI_ENV);
    assert.equal(result.status, 0, result.combined);
    assert.match(result.combined, /mode: release v0\.2\.0/);
  }, { tag: false });
});

test('mutation proof (R5): a row naming a release newer than the tag being published is refused', () => {
  withGitRepo('release-future', (root) => {
    writeSkill(root, 'nfs-alpha', '0.3.0', '2026-10-05',
      [['0.3.0', '2026-10-05', 'v0.3.0', 'changed', 'Later work.'], ...RELEASED]);
    const result = runClonedChecker(root, SCRIPT, ['--release', 'v0.2.0'], CI_ENV);
    assert.equal(result.status, 1, result.combined);
    assert.match(result.combined, /names release v0\.3\.0, newer than the tag being published, v0\.2\.0 \(R5\)/);
  });
});

test('release mode: a malformed tag argument is an operational error (exit 2)', () => {
  withGitRepo('release-bad-arg', (root) => {
    const result = runClonedChecker(root, SCRIPT, ['--release', 'release-two'], LOCAL_ENV);
    assert.equal(result.status, 2, result.combined);
  });
});
