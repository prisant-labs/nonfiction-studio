// tests/checks/check-skill-cli-targets.test.mjs
// what-it-is:   planted-violation tests for scripts/checks/check-skill-cli-targets.mjs
// what-it-does: runs the real checker script (a standalone process, invoked directly, not a
//               check(ctx) module) against isolated fixtures, with every planted violation
//               confined to a temp clone or a from-scratch synthetic root - never the live
//               working tree. Two fixture styles, both reused from
//               tests/checks/check-workspace-refs.test.mjs's own established split:
//                 (1) synthetic fixtures (buildSyntheticRoot below): a from-scratch temp
//                     directory carrying only a fresh copy of this repo's CURRENT on-disk
//                     checker script plus invented bin/ and skills/ content, so detection and
//                     the false-positive guard can be proven without depending on this repo's
//                     real shipped skills at all;
//                 (2) real-repo clones (clone-helper.mjs's cloneRepoToTemp), which exercise the
//                     checker against the actual skills/**/SKILL.md scan scope, proving the
//                     mechanism also confirms status-dashboard's real bin/ns-status routing
//                     target resolves, and that a deliberate corruption of that same real
//                     reference is caught.
//               Every fixture gets a fresh copy of THIS REPO'S CURRENT on-disk checker script
//               (see copyFromRepo below), copied in directly rather than relying on the script
//               being staged in git's index, so this suite is never coupled to staging order
//               during iteration - the same discipline check-workspace-refs.test.mjs uses.
// why:          F-CI-07 (dispatcher and CLI-wrapper skills uncovered) - closed for
//               status-dashboard's bin/ns-status reference specifically; these tests are the
//               durable, permanent proof that the checker has real teeth - F6 (checker negative
//               tests): "a checker that cannot fail is not a checker" - not only a one-time
//               manual run.
// runner:       node --test "tests/checks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, REPO_ROOT } from './clone-helper.mjs';

const SCRIPT = 'scripts/checks/check-skill-cli-targets.mjs';

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
 * Builds a from-scratch temp directory carrying a fresh copy of this repo's CURRENT on-disk
 * checker script, plus caller-supplied bin/ and skills/ content. Not derived from the real
 * tracked tree at all, so assertions here are never contaminated by anything already present
 * in this repo.
 */
function buildSyntheticRoot(label, files) {
  const root = mkdtempSync(join(tmpdir(), 'nonfiction-skill-cli-targets-synth-' + label + '-'));
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
// Synthetic fixtures
// ---------------------------------------------------------------------------

test('clean synthetic fixture (every bin/ns-<name> routing target resolves) exits 0', () => {
  const { root, cleanup } = buildSyntheticRoot('clean', {
    'bin/ns-widget': '#!/usr/bin/env node\n',
    'skills/widget-tool/SKILL.md': 'Invoke `node "<plugin-root>/bin/ns-widget" --project=. --json`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'must exit 0 when every named routing target exists; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('a deliberately wrong CLI name in a routing target is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('wrong-name', {
    'bin/ns-widget': '#!/usr/bin/env node\n',
    'skills/widget-tool/SKILL.md': 'Invoke `node "<plugin-root>/bin/ns-widgetzz" --project=. --json`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1 on a routing target that does not exist; got: ' + result.combined);
    assert.match(result.combined, /skills\/widget-tool\/SKILL\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /routing target/, 'message must name the violation type');
    assert.match(result.combined, /ns-widgetzz/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('false-positive guard: a bare "ns-<name>" mention with no "bin/" prefix is not flagged', () => {
  const { root, cleanup } = buildSyntheticRoot('bare-mention', {
    'skills/widget-tool/SKILL.md': 'This skill is a sibling of ns-nonexistent-cli, mentioned here in passing only.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a bare CLI-name mention with no "bin/" prefix must not be flagged; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Real-repo integration: proves the mechanism against the actual scan scope,
// including status-dashboard's real bin/ns-status routing target.
// ---------------------------------------------------------------------------

test('real-repo scope: every shipped skill\'s bin/ns-<name> routing target resolves', () => {
  const { root, cleanup } = cloneRealRepo('real-clean');
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'the real, current tree must have no unresolved routing targets; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('real-repo scope: status-dashboard names bin/ns-status as its routing target, and the checker confirms it resolves', () => {
  const { root, cleanup } = cloneRealRepo('real-status-dashboard-positive');
  try {
    const skillPath = join(root, 'skills', 'nfs-status-dashboard', 'SKILL.md');
    const text = readFileSync(skillPath, 'utf8');
    assert.match(
      text, /bin\/ns-status\b/,
      'skills/nfs-status-dashboard/SKILL.md must name bin/ns-status as its routing target for this test to be meaningful'
    );

    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'got: ' + result.combined);
    assert.doesNotMatch(result.combined, /ns-status[^a-z0-9-]/i, 'ns-status must never appear as a finding');
  } finally {
    cleanup();
  }
});

test('real-repo scope: a deliberately corrupted bin/ns-status reference in status-dashboard/SKILL.md is caught', () => {
  const { root, cleanup } = cloneRealRepo('real-status-dashboard-corrupted');
  try {
    const skillPath = join(root, 'skills', 'nfs-status-dashboard', 'SKILL.md');
    const before = readFileSync(skillPath, 'utf8');
    const bogusName = 'ns-statu' + 'z'; // assembled so this file's own source never reads as a real CLI name
    const after = before.split('bin/ns-status').join('bin/' + bogusName);
    assert.notEqual(
      after, before,
      'skills/nfs-status-dashboard/SKILL.md must contain at least one "bin/ns-status" occurrence to corrupt for this test to be meaningful'
    );
    writeFileSync(skillPath, after);

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1 once the routing target is corrupted; got: ' + result.combined);
    assert.match(result.combined, /skills\/nfs-status-dashboard\/SKILL\.md:\d+:/, 'message must name the corrupted file and line');
    assert.match(result.combined, new RegExp(bogusName), 'message must name the corrupted CLI name verbatim');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Forward-growth simulation: PF-22 (checker coverage shapes) widening 1 -
// the scan scope grew from skills/**/SKILL.md only to every git-tracked .md
// file under agents/, docs/, examples/, skills/, templates/, plus
// root-level .md files, except docs/adr/ and docs/gates/ (dated historical
// records, same rationale and mechanism as check-component-counts.mjs's
// HISTORICAL_RECORD_PREFIXES). One planted bin/ns-nonexistent reference per
// newly scanned directory class proves each class is actually reached, and
// one planted reference under docs/adr/ proves the exemption holds.
// ---------------------------------------------------------------------------

test('widened scope: a broken bin/ns-<name> reference under agents/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('widened-agents', {
    'agents/some-agent.md': 'This agent routes through `bin/ns-nonexistent`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target under agents/; got: ' + result.combined);
    assert.match(result.combined, /agents\/some-agent\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('widened scope: a broken bin/ns-<name> reference under docs/ (outside docs/adr/ and docs/gates/) is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('widened-docs', {
    'docs/reference/some-doc.md': 'This doc routes through `bin/ns-nonexistent`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target under docs/; got: ' + result.combined);
    assert.match(result.combined, /docs\/reference\/some-doc\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('widened scope: a broken bin/ns-<name> reference under examples/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('widened-examples', {
    'examples/some-example/NOTES.md': 'This example routes through `bin/ns-nonexistent`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target under examples/; got: ' + result.combined);
    assert.match(result.combined, /examples\/some-example\/NOTES\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('widened scope: a broken bin/ns-<name> reference in a non-SKILL.md file under skills/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('widened-skills-nonskill', {
    'skills/widget-tool/NOTES.md': 'This note routes through `bin/ns-nonexistent`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target in a non-SKILL.md file under skills/; got: ' + result.combined);
    assert.match(result.combined, /skills\/widget-tool\/NOTES\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('widened scope: a broken bin/ns-<name> reference under templates/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('widened-templates', {
    'templates/some-template/README.md': 'This template routes through `bin/ns-nonexistent`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target under templates/; got: ' + result.combined);
    assert.match(result.combined, /templates\/some-template\/README\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('widened scope: a broken bin/ns-<name> reference in a root-level .md file is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('widened-root', {
    'SOME-ROOT-DOC.md': 'This root doc routes through `bin/ns-nonexistent`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target in a root-level .md file; got: ' + result.combined);
    assert.match(result.combined, /SOME-ROOT-DOC\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('dated-record exemption: a broken bin/ns-<name> reference under docs/adr/ is NOT flagged', () => {
  const { root, cleanup } = buildSyntheticRoot('adr-exempt', {
    'docs/adr/ADR-9999-fake-decision.md': 'This ADR routes through `bin/ns-nonexistent`.\n',
    'skills/other-tool/SKILL.md': 'Nothing interesting here.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a reference under docs/adr/ must not be flagged (dated historical record exemption); got: ' + result.combined);
    assert.doesNotMatch(result.combined, /ns-nonexistent/, 'the exempt ADR file\'s bogus reference must never appear as a finding');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Git-tracked mode: every test above runs through clone-helper.mjs (either
// cloneRepoToTemp or a from-scratch synthetic root), and clone-helper.mjs
// deliberately strips .git from every fixture it builds - that is the
// documented mechanism the whole file relies on to exercise this checker's
// degraded filesystem-walk fallback consistently. That leaves this
// checker's OTHER code path, git-tracked mode (getGitTrackedFiles), with no
// coverage from any test above: it is the mode a real checkout always runs
// in (a fresh `actions/checkout` leaves .git present), and CI's own direct
// step (.github/workflows/tier-a.yml, "Skill CLI routing targets") is the
// primary proof of it, matching how the three sibling standalone checkers
// are covered. This test adds a second, permanent proof of the same code
// path without touching clone-helper.mjs's single-purpose design: it runs
// the real, current on-disk checker script directly against REPO_ROOT
// itself (no clone, no copy - the exact real file at its exact real path),
// which necessarily has real git metadata. runClonedChecker is reused
// unmodified; REPO_ROOT is simply passed as the root instead of a clone's
// root, which is a legitimate, already-supported call shape, not a
// workaround. The checker only ever reads files and git output and writes
// to stdout/stderr, so running it in place against the live repo makes no
// filesystem change of any kind.
// ---------------------------------------------------------------------------

test('git-tracked mode: running the checker in place against this repo\'s real .git engages git-tracked mode, not the degraded fallback', () => {
  const result = runClonedChecker(REPO_ROOT, SCRIPT);
  assert.equal(result.status, 0, 'the real, current tree must have no unresolved routing targets; got: ' + result.combined);
  assert.match(
    result.combined, /mode: git-tracked/,
    'must report git-tracked mode, not degraded mode, when run in place against a real checkout; got: ' + result.combined
  );
  assert.doesNotMatch(
    result.combined, /NOTE: degraded mode/,
    'must not fall back to the degraded filesystem-walk path when real git metadata is present; got: ' + result.combined
  );
});
