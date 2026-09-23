// tests/checks/check-link-labels.test.mjs
// what-it-is:   planted-violation tests for scripts/checks/check-link-labels.mjs
// what-it-does: runs the real checker script (a standalone process, invoked directly, not a
//               check(ctx) module) against isolated fixtures, with every planted violation
//               confined to a temp clone or a from-scratch synthetic root - never the live
//               working tree. Two fixture styles, both reused from
//               tests/checks/check-advertised-invocations.test.mjs's own established split:
//                 (1) synthetic fixtures (buildSyntheticRoot below): a from-scratch temp
//                     directory carrying only a fresh copy of this repo's CURRENT on-disk
//                     checker script plus invented docs/skills content, so every rule shape can
//                     be proven without depending on this repo's real shipped content at all -
//                     every fixture below uses an invented component, "acme-gizmo", never a real
//                     shipped name, so a fixture can never collide with a real component page;
//                 (2) a real-repo clone (clone-helper.mjs's cloneRepoToTemp), which exercises the
//                     checker against the actual shipped scan scope and asserts the real, current
//                     tree carries zero label defects.
//               Every fixture gets a fresh copy of THIS REPO'S CURRENT on-disk checker script
//               (see copyFromRepo below), copied in directly rather than relying on the script
//               being staged in git's index, so this suite is never coupled to staging order
//               during iteration - the same discipline the sibling checker test files use.
// why:          F6 (checker negative tests): "a checker that cannot fail is not a checker" -
//               these are the durable, permanent proof that each rule shape this checker exists
//               to enforce actually fires, not only a one-time manual replay against history.
// runner:       node --test "tests/checks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, REPO_ROOT } from './clone-helper.mjs';

const SCRIPT = 'scripts/checks/check-link-labels.mjs';

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
 * checker script, plus caller-supplied files. Not derived from the real tracked tree at all, so
 * assertions here are never contaminated by anything already present in this repo.
 */
function buildSyntheticRoot(label, files) {
  const root = mkdtempSync(join(tmpdir(), 'nonfiction-link-labels-synth-' + label + '-'));
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

// The invented component every fixture below targets: a page at
// docs/reference/skills/acme-gizmo.md (plus an .example.md variant for the example-target
// fixtures). "gizmo" stands in for a component's OLD, pre-rename name; "acme-gizmo" is the
// CURRENT shipped name the page documents - the exact shape the real rename-wave defects took.
const GIZMO_PAGE = 'docs/reference/skills/acme-gizmo.md';
const GIZMO_PAGE_CONTENT = 'The acme-gizmo skill reference page.\n\n## Some Section\n\nBody text.\n';
const GIZMO_EXAMPLE_PAGE = 'docs/reference/skills/acme-gizmo.example.md';
const GIZMO_EXAMPLE_CONTENT = 'The acme-gizmo example transcript.\n';

// ---------------------------------------------------------------------------
// Rule A: bare old-name label, and old name + "skill reference" - the two
// shapes the real 32-finding replay showed most often.
// ---------------------------------------------------------------------------

test('a bare old-name label that no longer matches the current component name is flagged', () => {
  const { root, cleanup } = buildSyntheticRoot('bare-old-name', {
    [GIZMO_PAGE]: GIZMO_PAGE_CONTENT,
    'SOME-DOC.md': 'See [gizmo](docs/reference/skills/acme-gizmo.md) for details.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a bare old-name label; got: ' + result.combined);
    assert.match(result.combined, /SOME-DOC\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /"gizmo"/, 'message must name the label verbatim');
    assert.match(result.combined, /"acme-gizmo"/, 'message must name the current component verbatim');
  } finally {
    cleanup();
  }
});

test('an old name followed by "skill reference" is flagged', () => {
  const { root, cleanup } = buildSyntheticRoot('old-name-skill-reference', {
    [GIZMO_PAGE]: GIZMO_PAGE_CONTENT,
    'SOME-DOC.md': 'See the [gizmo skill reference](docs/reference/skills/acme-gizmo.md) for details.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on "old-name skill reference"; got: ' + result.combined);
    assert.match(result.combined, /SOME-DOC\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /"gizmo skill reference"/, 'message must name the label verbatim');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Fragment handling: a non-slug label is flagged even with a fragment
// present; a label whose GitHub-style slug equals the fragment is silent.
// ---------------------------------------------------------------------------

test('a fragment link whose label is neither the token nor the fragment\'s slug is flagged', () => {
  const { root, cleanup } = buildSyntheticRoot('fragment-non-slug', {
    [GIZMO_PAGE]: GIZMO_PAGE_CONTENT,
    'SOME-DOC.md': 'See the [gizmo skill reference](docs/reference/skills/acme-gizmo.md#some-section) for details.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 when neither the token test nor the fragment-slug test passes; got: ' + result.combined);
    assert.match(result.combined, /SOME-DOC\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /fragment "#some-section" does not match the label's slug either/, 'message must explain the fragment path was also tried and failed');
  } finally {
    cleanup();
  }
});

test('fragment acceptance: a label whose GitHub-style slug equals the fragment is silent', () => {
  const { root, cleanup } = buildSyntheticRoot('fragment-slug-silent', {
    [GIZMO_PAGE]: GIZMO_PAGE_CONTENT,
    'SOME-DOC.md': 'See [Some Section](docs/reference/skills/acme-gizmo.md#some-section) for details.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a label whose slug equals the fragment must not be flagged; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Relative "../" href resolution: flags when the label is wrong, passes when
// the label correctly names the component.
// ---------------------------------------------------------------------------

test('relative "../" href: a wrong label is flagged once the href is resolved', () => {
  const { root, cleanup } = buildSyntheticRoot('relative-dotdot-wrong', {
    [GIZMO_PAGE]: GIZMO_PAGE_CONTENT,
    'docs/reference/cli/some-cli.md': 'See the [gizmo skill reference](../skills/acme-gizmo.md) for details.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 once the "../" href is resolved to the real component page; got: ' + result.combined);
    assert.match(result.combined, /docs\/reference\/cli\/some-cli\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, new RegExp(GIZMO_PAGE.replace(/\//g, '\\/')), 'message must name the resolved target path');
  } finally {
    cleanup();
  }
});

test('relative "../" href: a correct label passes once the href is resolved', () => {
  const { root, cleanup } = buildSyntheticRoot('relative-dotdot-right', {
    [GIZMO_PAGE]: GIZMO_PAGE_CONTENT,
    'docs/reference/cli/some-cli.md': 'See the [acme-gizmo skill reference](../skills/acme-gizmo.md) for details.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a correct label must not be flagged once the "../" href is resolved; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// ".example.md" target: flags when the label is wrong, passes when correct.
// ---------------------------------------------------------------------------

test('an ".example.md" target with a wrong label is flagged', () => {
  const { root, cleanup } = buildSyntheticRoot('example-target-wrong', {
    [GIZMO_EXAMPLE_PAGE]: GIZMO_EXAMPLE_CONTENT,
    'SOME-DOC.md': 'See [gizmo](docs/reference/skills/acme-gizmo.example.md) for a transcript.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a wrong label targeting an .example.md page; got: ' + result.combined);
    assert.match(result.combined, /SOME-DOC\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /"acme-gizmo"/, 'message must name the component the .example.md page documents');
  } finally {
    cleanup();
  }
});

test('an ".example.md" target with a correct label passes', () => {
  const { root, cleanup } = buildSyntheticRoot('example-target-right', {
    [GIZMO_EXAMPLE_PAGE]: GIZMO_EXAMPLE_CONTENT,
    'SOME-DOC.md': 'See [acme-gizmo.example.md](docs/reference/skills/acme-gizmo.example.md) for a transcript.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a correct label targeting an .example.md page must not be flagged; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Code is not prose: a link fully inside an inline code span, or fully
// inside a fenced code block, is never scanned.
// ---------------------------------------------------------------------------

test('a link inside an inline code span is silent', () => {
  const { root, cleanup } = buildSyntheticRoot('code-span-silent', {
    [GIZMO_PAGE]: GIZMO_PAGE_CONTENT,
    'SOME-DOC.md': 'For example: `[gizmo](docs/reference/skills/acme-gizmo.md)` is what a stale label used to look like.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a link entirely inside an inline code span must not be scanned; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('a link inside a fenced code block is silent', () => {
  const { root, cleanup } = buildSyntheticRoot('fenced-block-silent', {
    [GIZMO_PAGE]: GIZMO_PAGE_CONTENT,
    'SOME-DOC.md': 'An example:\n\n```markdown\n[gizmo](docs/reference/skills/acme-gizmo.md)\n```\n\nEnd of example.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a link entirely inside a fenced code block must not be scanned; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('a label containing a nested code span (not the whole link) is still scanned normally', () => {
  const { root, cleanup } = buildSyntheticRoot('nested-code-span-in-label', {
    [GIZMO_PAGE]: GIZMO_PAGE_CONTENT,
    'SOME-DOC.md': 'See [`acme-gizmo`](docs/reference/skills/acme-gizmo.md) for details.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a real link whose label merely contains a nested code span must still be evaluated and pass; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Rule B: a bare-name-only label whose href does not resolve to ANY
// component page (the one gap Rule A cannot see, since it never gets a
// component name to test the label against).
// ---------------------------------------------------------------------------

test('Rule B: a bare-name-only label whose href resolves to no component page at all is flagged', () => {
  const { root, cleanup } = buildSyntheticRoot('rule-b-misdirected', {
    [GIZMO_PAGE]: GIZMO_PAGE_CONTENT,
    'docs/reference/unrelated.md': 'Nothing about acme-gizmo here.\n',
    'SOME-DOC.md': 'See [acme-gizmo](docs/reference/unrelated.md) for details.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 when a bare-name label misdirects to a non-component page; got: ' + result.combined);
    assert.match(result.combined, /SOME-DOC\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /is not that component's page/, 'message must name the Rule B violation shape');
  } finally {
    cleanup();
  }
});

test('Rule B: a bare-name-only label linking to its own component page passes', () => {
  const { root, cleanup } = buildSyntheticRoot('rule-b-correct', {
    [GIZMO_PAGE]: GIZMO_PAGE_CONTENT,
    'SOME-DOC.md': 'See [acme-gizmo](docs/reference/skills/acme-gizmo.md) for details.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a bare-name label linking to its own page must not be flagged; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Operational error and false-positive guards
// ---------------------------------------------------------------------------

test('zero-file scope exits 2', () => {
  const root = mkdtempSync(join(tmpdir(), 'nonfiction-link-labels-empty-'));
  copyFromRepo(root, SCRIPT);
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 2, 'must exit 2 when zero files match the scan scope; got: ' + result.combined);
    assert.match(result.combined, /FATAL/, 'message must name the operational-error condition');
  } finally {
    safeRemove(root);
  }
});

test('an image link is never flagged even with a mismatched alt text', () => {
  const { root, cleanup } = buildSyntheticRoot('image-not-flagged', {
    [GIZMO_PAGE]: GIZMO_PAGE_CONTENT,
    'SOME-DOC.md': 'A diagram: ![gizmo](docs/reference/skills/acme-gizmo.md)\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'an image (leading "!") must never be treated as a component-page link; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('a link whose href does not resolve to any component page shape is not flagged (Rule A only applies to component pages)', () => {
  const { root, cleanup } = buildSyntheticRoot('non-component-target', {
    'docs/reference/unrelated.md': 'Unrelated content.\n',
    'SOME-DOC.md': 'See [something else entirely](docs/reference/unrelated.md) for details.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a link to a non-component page must never be flagged; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Real-repo integration: proves the mechanism against the actual scan scope.
// ---------------------------------------------------------------------------

test('real-repo scope: every component-page link label in the current tree names its target', () => {
  const { root, cleanup } = cloneRealRepo('real-clean');
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'the real, current tree must have no label defects; got: ' + result.combined);
    assert.match(result.combined, /component-page link\(s\) found/, 'pass line must report the component-page link count; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('real-repo scope: a deliberately reverted label on nfs-doctor\'s own reference page is caught', () => {
  const { root, cleanup } = cloneRealRepo('real-doctor-corrupted');
  try {
    const skillPath = join(root, 'docs', 'reference', 'cli', 'ns-doctor.md');
    const before = readFileSync(skillPath, 'utf8');
    const after = before.replace('[nfs-doctor skill reference]', '[doctor skill reference]');
    assert.notEqual(after, before, 'docs/reference/cli/ns-doctor.md must contain "[nfs-doctor skill reference]" for this test to be meaningful');
    writeFileSync(skillPath, after);

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1 once a label is reverted to its old, pre-rename name; got: ' + result.combined);
    assert.match(result.combined, /doctor skill reference/, 'message must name the reverted label verbatim');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Git-tracked mode: every test above runs through clone-helper.mjs, which
// deliberately strips .git from every fixture it builds - the documented
// mechanism this whole file relies on to exercise the checker's degraded
// filesystem-walk fallback consistently. That leaves the checker's OTHER
// code path, git-tracked mode (getGitTrackedFiles), with no coverage from
// any test above: it is the mode a real checkout always runs in, and CI's
// own direct step is the primary proof of it, matching how the sibling
// standalone checkers are covered. This test adds a second, permanent proof
// of the same code path without touching clone-helper.mjs's design: it runs
// the real, current on-disk checker script directly against REPO_ROOT
// itself (no clone, no copy), which necessarily has real git metadata. The
// checker only ever reads files and git output and writes to stdout/stderr,
// so running it in place makes no filesystem change of any kind.
// ---------------------------------------------------------------------------

test('git-tracked mode: running the checker in place against this repo\'s real .git engages git-tracked mode, not the degraded fallback', () => {
  const result = runClonedChecker(REPO_ROOT, SCRIPT);
  assert.equal(result.status, 0, 'the real, current tree must have no label defects; got: ' + result.combined);
  assert.match(
    result.combined, /mode: git-tracked/,
    'must report git-tracked mode, not degraded mode, when run in place against a real checkout; got: ' + result.combined
  );
  assert.doesNotMatch(
    result.combined, /NOTE: degraded mode/,
    'must not fall back to the degraded filesystem-walk path when real git metadata is present; got: ' + result.combined
  );
});
