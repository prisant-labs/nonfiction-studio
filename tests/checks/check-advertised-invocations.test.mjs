// tests/checks/check-advertised-invocations.test.mjs
// what-it-is:   planted-violation tests for scripts/checks/check-advertised-invocations.mjs
// what-it-does: runs the real checker script (a standalone process, invoked directly, not a
//               check(ctx) module) against isolated fixtures, with every planted violation
//               confined to a temp clone or a from-scratch synthetic root - never the live
//               working tree. Two fixture styles, both reused from
//               tests/checks/check-skill-cli-targets.test.mjs's own established split:
//                 (1) synthetic fixtures (buildSyntheticRoot below): a from-scratch temp
//                     directory carrying only a fresh copy of this repo's CURRENT on-disk
//                     checker script plus invented skills/ content, so detection and the
//                     false-positive guard can be proven without depending on this repo's real
//                     shipped skills at all;
//                 (2) real-repo clones (clone-helper.mjs's cloneRepoToTemp), which exercise the
//                     checker against the actual shipped-Markdown scan scope, proving the real,
//                     current tree resolves every advertised invocation (this test was RED until
//                     the CHANGELOG.md revise-pass reword landed in the same change, per PF-09
//                     (revise-pass phantom)).
//               Every fixture gets a fresh copy of THIS REPO'S CURRENT on-disk checker script
//               (see copyFromRepo below), copied in directly rather than relying on the script
//               being staged in git's index, so this suite is never coupled to staging order
//               during iteration - the same discipline check-skill-cli-targets.test.mjs uses.
// why:          PF-09 (revise-pass phantom) - a shipped example document told a reader to run
//               `/nonfiction-studio:revise-pass`, an invocation that had never existed as a
//               skill; these tests are the durable, permanent proof that the checker has real
//               teeth - F6 (checker negative tests): "a checker that cannot fail is not a
//               checker" - not only a one-time manual run.
// runner:       node --test "tests/checks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, REPO_ROOT } from './clone-helper.mjs';

const SCRIPT = 'scripts/checks/check-advertised-invocations.mjs';

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
 * checker script, plus caller-supplied skills/ (and other) content. Not derived from the real
 * tracked tree at all, so assertions here are never contaminated by anything already present
 * in this repo.
 */
function buildSyntheticRoot(label, files) {
  const root = mkdtempSync(join(tmpdir(), 'nonfiction-advertised-invocations-synth-' + label + '-'));
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

test('clean synthetic fixture (every advertised invocation resolves) exits 0', () => {
  const { root, cleanup } = buildSyntheticRoot('clean', {
    'skills/widget-tool/SKILL.md': 'Some real skill content.\n',
    'docs/reference/some-doc.md': 'Run `/nonfiction-studio:widget-tool` to get started.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'must exit 0 when every advertised invocation resolves; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('a phantom invocation (no matching skills/<name>/ directory) is caught with file:line', () => {
  const { root, cleanup } = buildSyntheticRoot('phantom', {
    'skills/widget-tool/SKILL.md': 'Some real skill content.\n',
    'docs/reference/some-doc.md': 'Run `/nonfiction-studio:phantom-tool` to get started.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1 on an advertised invocation with no shipped skill; got: ' + result.combined);
    assert.match(result.combined, /docs\/reference\/some-doc\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /advertised invocation/, 'message must name the violation type');
    assert.match(result.combined, /phantom-tool/, 'message must name the phantom name verbatim');
  } finally {
    cleanup();
  }
});

test('a bare "nonfiction-studio:<name>" mention with no leading slash is not flagged', () => {
  const { root, cleanup } = buildSyntheticRoot('bare-mention', {
    'docs/reference/some-doc.md': 'This document mentions nonfiction-studio:phantom-tool in passing only, with no leading slash.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a bare mention with no leading slash must not be flagged; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('dated-record exemption: a phantom invocation under docs/adr/ is NOT flagged', () => {
  const { root, cleanup } = buildSyntheticRoot('adr-exempt', {
    'docs/adr/ADR-9999-fake-decision.md': 'The spike probe `/nonfiction-studio:spike-fake` resolved as expected.\n',
    'skills/other-tool/SKILL.md': 'Nothing interesting here.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a reference under docs/adr/ must not be flagged (dated historical record exemption); got: ' + result.combined);
    assert.doesNotMatch(result.combined, /spike-fake/, 'the exempt ADR file\'s phantom invocation must never appear as a finding');
  } finally {
    cleanup();
  }
});

test('dated-record exemption: a phantom invocation under docs/gates/ is NOT flagged', () => {
  const { root, cleanup } = buildSyntheticRoot('gates-exempt', {
    'docs/gates/2026-01-01-fake-gate.md': 'At this gate, `/nonfiction-studio:gate-fake` was the recommended next step.\n',
    'skills/other-tool/SKILL.md': 'Nothing interesting here.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a reference under docs/gates/ must not be flagged (dated historical record exemption); got: ' + result.combined);
    assert.doesNotMatch(result.combined, /gate-fake/, 'the exempt gate doc\'s phantom invocation must never appear as a finding');
  } finally {
    cleanup();
  }
});

test('widened scope: a phantom invocation under agents/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('widened-agents', {
    'agents/some-agent.md': 'This agent hands off with `/nonfiction-studio:phantom-tool`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a phantom invocation under agents/; got: ' + result.combined);
    assert.match(result.combined, /agents\/some-agent\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /phantom-tool/, 'message must name the phantom name verbatim');
  } finally {
    cleanup();
  }
});

test('widened scope: a phantom invocation under examples/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('widened-examples', {
    'examples/some-example/NOTES.md': 'This example invokes `/nonfiction-studio:phantom-tool`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a phantom invocation under examples/; got: ' + result.combined);
    assert.match(result.combined, /examples\/some-example\/NOTES\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /phantom-tool/, 'message must name the phantom name verbatim');
  } finally {
    cleanup();
  }
});

test('widened scope: a phantom invocation in a non-SKILL.md file under skills/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('widened-skills-nonskill', {
    'skills/widget-tool/NOTES.md': 'This note invokes `/nonfiction-studio:phantom-tool`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a phantom invocation in a non-SKILL.md file under skills/; got: ' + result.combined);
    assert.match(result.combined, /skills\/widget-tool\/NOTES\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /phantom-tool/, 'message must name the phantom name verbatim');
  } finally {
    cleanup();
  }
});

test('widened scope: a phantom invocation under templates/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('widened-templates', {
    'templates/some-template/README.md': 'This template invokes `/nonfiction-studio:phantom-tool`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a phantom invocation under templates/; got: ' + result.combined);
    assert.match(result.combined, /templates\/some-template\/README\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /phantom-tool/, 'message must name the phantom name verbatim');
  } finally {
    cleanup();
  }
});

test('widened scope: a phantom invocation in a root-level .md file is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('widened-root', {
    'SOME-ROOT-DOC.md': 'This root doc invokes `/nonfiction-studio:phantom-tool`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a phantom invocation in a root-level .md file; got: ' + result.combined);
    assert.match(result.combined, /SOME-ROOT-DOC\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /phantom-tool/, 'message must name the phantom name verbatim');
  } finally {
    cleanup();
  }
});

test('scope widening: a phantom invocation under output-styles/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('widened-output-styles', {
    'output-styles/some-style.md': 'This style invokes `/nonfiction-studio:phantom-tool`.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a phantom invocation under output-styles/; got: ' + result.combined);
    assert.match(result.combined, /output-styles\/some-style\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /phantom-tool/, 'message must name the phantom name verbatim');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Real-repo integration: proves the mechanism against the actual scan scope.
// The first test here is RED until CHANGELOG.md's revise-pass line is
// reworded (PF-09, revise-pass phantom) - the checker's own real-tree proof
// that the phantom it was written to catch is real.
// ---------------------------------------------------------------------------

test('real-repo scope: every advertised invocation in the current tree resolves to a shipped skill', () => {
  const { root, cleanup } = cloneRealRepo('real-clean');
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'the real, current tree must have no unresolved advertised invocations; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('real-repo scope: a deliberately corrupted advertised invocation in skills/nfs-start/SKILL.md is caught', () => {
  const { root, cleanup } = cloneRealRepo('real-studio-corrupted');
  try {
    const skillPath = join(root, 'skills', 'nfs-start', 'SKILL.md');
    const before = readFileSync(skillPath, 'utf8');
    const bogusName = 'phantom-corrupt-tool';
    const after = before + '\n\nRun `/nonfiction-studio:' + bogusName + '` for a corrupted reference.\n';
    writeFileSync(skillPath, after);

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1 once a phantom invocation is planted; got: ' + result.combined);
    assert.match(result.combined, new RegExp(bogusName), 'message must name the corrupted invocation name verbatim');
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
// step (.github/workflows/tier-a.yml, "Advertised invocations") is the
// primary proof of it, matching how the sibling standalone checkers are
// covered. This test adds a second, permanent proof of the same code path
// without touching clone-helper.mjs's single-purpose design: it runs the
// real, current on-disk checker script directly against REPO_ROOT itself
// (no clone, no copy - the exact real file at its exact real path), which
// necessarily has real git metadata. runClonedChecker is reused unmodified;
// REPO_ROOT is simply passed as the root instead of a clone's root, which is
// a legitimate, already-supported call shape, not a workaround. The checker
// only ever reads files and git output and writes to stdout/stderr, so
// running it in place against the live repo makes no filesystem change of
// any kind.
// ---------------------------------------------------------------------------

test('git-tracked mode: running the checker in place against this repo\'s real .git engages git-tracked mode, not the degraded fallback', () => {
  const result = runClonedChecker(REPO_ROOT, SCRIPT);
  assert.equal(result.status, 0, 'the real, current tree must have no unresolved advertised invocations; got: ' + result.combined);
  assert.match(
    result.combined, /mode: git-tracked/,
    'must report git-tracked mode, not degraded mode, when run in place against a real checkout; got: ' + result.combined
  );
  assert.doesNotMatch(
    result.combined, /NOTE: degraded mode/,
    'must not fall back to the degraded filesystem-walk path when real git metadata is present; got: ' + result.combined
  );
});
