// tests/checks/check-release-tag.test.mjs
// what-it-is:   tests for scripts/check-release-tag.mjs, the release tag workflow's only piece
//               of real logic
// what-it-does: runs the real script (a standalone script, invoked directly) against temp
//               clones of the tracked tree, mirroring tests/checks/check-self-sufficiency.test.mjs's
//               clone-and-plant pattern since this script also resolves its own repo root from
//               import.meta.url.
// why:          the tag-triggered release workflow (.github/workflows/release.yml) must verify
//               that the pushed tag agrees with every version-bearing manifest before
//               publishing a release; "zero validation logic in YAML" means that check has to
//               live here, not in the workflow file, and a checker that cannot fail is not a
//               checker (F6).
// runner:       node --test tests/checks/check-release-tag.test.mjs (or node --test tests/checks/)

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, REPO_ROOT } from './clone-helper.mjs';

const SCRIPT = 'scripts/check-release-tag.mjs';

after(() => {
  cleanupGoldenClone();
});

// Read the live tree's actual version from its own source of truth rather than hardcoding it,
// so this suite never goes stale the moment a release bumps library.json - the same "name the
// constant, do not restate the value" discipline tests/checks/version-literals.test.mjs
// enforces on shipped prose, applied here to a test file's own fixture data.
const LIVE_VERSION = JSON.parse(readFileSync(join(REPO_ROOT, 'library.json'), 'utf8')).version;
const LIVE_TAG = 'v' + LIVE_VERSION;
// A value guaranteed to differ from LIVE_VERSION, used wherever a test needs a manifest to
// disagree with the rest of the tree (never a hand-picked literal that could coincidentally
// equal a future LIVE_VERSION).
const DRIFTED_VERSION = LIVE_VERSION + '-drift-test';

test('tag matches all three manifests -> pass, exit 0', () => {
  const { root, cleanup } = cloneRepoToTemp('release-tag-match');
  try {
    // A "v" prefix on the tag is stripped before comparison.
    const result = runClonedChecker(root, SCRIPT, [LIVE_TAG]);
    assert.equal(result.status, 0, 'must exit 0; got: ' + result.combined);
    assert.match(result.combined, /pass/i);
  } finally {
    cleanup();
  }
});

test('tag without a "v" prefix also matches -> pass, exit 0', () => {
  const { root, cleanup } = cloneRepoToTemp('release-tag-no-prefix');
  try {
    const result = runClonedChecker(root, SCRIPT, [LIVE_VERSION]);
    assert.equal(result.status, 0, 'must exit 0; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('tag disagrees with the manifests -> named failure, exit 1', () => {
  const { root, cleanup } = cloneRepoToTemp('release-tag-mismatch');
  try {
    const result = runClonedChecker(root, SCRIPT, ['v9.9.9']);
    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /library\.json/, 'must name a disagreeing manifest');
    assert.match(result.combined, /9\.9\.9/, 'must name the tag it compared against');
  } finally {
    cleanup();
  }
});

test('one manifest edited out of step with the others -> named failure, exit 1', () => {
  const { root, cleanup } = cloneRepoToTemp('release-tag-one-manifest-drifted');
  try {
    const pkgPath = join(root, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.version = DRIFTED_VERSION;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

    const result = runClonedChecker(root, SCRIPT, [LIVE_TAG]);
    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /package\.json/, 'must name the drifted manifest');
    assert.doesNotMatch(result.combined, /library\.json.*MISMATCH|MISMATCH.*library\.json/s, 'must not falsely accuse the manifest that still agrees');
  } finally {
    cleanup();
  }
});

test('no tag given and no GITHUB_REF_NAME set -> operational error, exit 2', () => {
  const { root, cleanup } = cloneRepoToTemp('release-tag-no-tag');
  try {
    // GITHUB_REF_NAME is a real GitHub Actions default env var, ambiently set on every Actions
    // run, including the run of THIS test suite under Tier A CI. Explicitly removed so the
    // outcome is deterministic regardless of where the suite executes, not just on a machine
    // that happens not to have it set.
    const env = { ...process.env };
    delete env.GITHUB_REF_NAME;
    const result = runClonedChecker(root, SCRIPT, [], env);
    assert.equal(result.status, 2, 'must exit 2; got: ' + result.combined);
  } finally {
    cleanup();
  }
});
