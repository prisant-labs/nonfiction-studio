// tests/checks/check-skill-cli-targets.test.mjs
// what-it-is:   planted-violation tests for scripts/checks/check-skill-cli-targets.mjs
// what-it-does: runs the real checker script (a standalone process, invoked directly, not a
//               check(ctx) module) against isolated fixtures, with every planted violation
//               confined to a temp clone or a from-scratch synthetic root - never the live
//               working tree. Two fixture styles, both reused from
//               tests/checks/check-workspace-refs.test.mjs's own established split:
//                 (1) synthetic fixtures (buildSyntheticRoot below): a from-scratch temp
//                     directory carrying only a fresh copy of this repo's CURRENT on-disk
//                     checker script plus invented content under whichever of hooks/, bin/,
//                     scripts/, agents/, templates/, evals/, examples/, skills/, or root-level
//                     files a given test needs, so detection and the false-positive guard can
//                     be proven without depending on this repo's real shipped content at all;
//                 (2) real-repo clones (clone-helper.mjs's cloneRepoToTemp), which exercise the
//                     checker against the actual Markdown and non-Markdown scan scopes together
//                     (see the checker's own header for both scopes' exact shape), proving the
//                     mechanism also confirms nfs-status-dashboard's real bin/ns-status routing
//                     target resolves, and that a deliberate corruption of that same real
//                     reference is caught.
//               Every fixture gets a fresh copy of THIS REPO'S CURRENT on-disk checker script
//               (see copyFromRepo below), copied in directly rather than relying on the script
//               being staged in git's index, so this suite is never coupled to staging order
//               during iteration - the same discipline check-workspace-refs.test.mjs uses.
// why:          F-CI-07 (dispatcher and CLI-wrapper skills uncovered) - closed for
//               nfs-status-dashboard's bin/ns-status reference specifically; these tests are the
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
 * checker script, plus caller-supplied content at whatever repo-relative paths a test names.
 * Not derived from the real tracked tree at all, so assertions here are never contaminated by
 * anything already present in this repo.
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
// including nfs-status-dashboard's real bin/ns-status routing target.
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

test('real-repo scope: nfs-status-dashboard names bin/ns-status as its routing target, and the checker confirms it resolves', () => {
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

test('real-repo scope: a deliberately corrupted bin/ns-status reference in nfs-status-dashboard/SKILL.md is caught', () => {
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
// Non-Markdown scope widening - PF-22 (checker coverage shapes) widening 2:
// every git-tracked non-.md file under hooks/, bin/, scripts/, agents/,
// templates/, evals/, examples/, and root-level non-.md files now gets the
// same bin/ns-<name> routing-target check the Markdown scope already ran.
// tests/ stays excluded (planted-fixture territory: ns-a through ns-h,
// ns-nonexistent, ns-widget, ns-zzz-simulated-growth - named here without a
// leading "bin/" deliberately, because this test file's own SCRIPT copy now
// lives inside the widened scan scope, and gluing "bin/" onto any
// nonexistent name in this comment would make this very file the finding).
// docs/adr/ and docs/gates/ stay exempt for the reason already given above.
// docs/ and skills/ are deliberately NOT part of the non-Markdown scope at
// all (their Markdown files are already covered above; a non-Markdown file
// under either stays unscanned, proven by the boundary test below).
// ---------------------------------------------------------------------------

test('non-Markdown scope: a broken bin/ns-<name> reference in a hooks/lib/*.mjs comment is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('nonmd-hooks', {
    'hooks/lib/thing.mjs': '// routes through bin/ns-nonexistent\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target inside a hooks/lib/*.mjs comment; got: ' + result.combined);
    assert.match(result.combined, /hooks\/lib\/thing\.mjs:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('non-Markdown scope: a broken bin/ns-<name> reference in a scripts/ file is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('nonmd-scripts', {
    'scripts/tool.mjs': '// see bin/ns-nonexistent for the sibling CLI\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target in a scripts/ file; got: ' + result.combined);
    assert.match(result.combined, /scripts\/tool\.mjs:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('non-Markdown scope: a broken bin/ns-<name> reference in a root-level non-.md file is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('nonmd-root', {
    'config.json': '{"note": "bin/ns-nonexistent"}\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target in a root-level non-.md file; got: ' + result.combined);
    assert.match(result.combined, /config\.json:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('non-Markdown scope: a broken bin/ns-<name> reference under bin/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('nonmd-bin', {
    'bin/notes.txt': 'sibling: bin/ns-nonexistent\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target under bin/; got: ' + result.combined);
    assert.match(result.combined, /bin\/notes\.txt:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('non-Markdown scope: a broken bin/ns-<name> reference in a non-Markdown file under agents/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('nonmd-agents', {
    'agents/notes.txt': 'routes through bin/ns-nonexistent\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target in a non-Markdown file under agents/; got: ' + result.combined);
    assert.match(result.combined, /agents\/notes\.txt:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('non-Markdown scope: a broken bin/ns-<name> reference in a non-Markdown file under templates/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('nonmd-templates', {
    'templates/some-template/notes.txt': 'routes through bin/ns-nonexistent\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target in a non-Markdown file under templates/; got: ' + result.combined);
    assert.match(result.combined, /templates\/some-template\/notes\.txt:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('non-Markdown scope: a broken bin/ns-<name> reference in a non-Markdown file under evals/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('nonmd-evals', {
    'evals/some.eval.json': '{"note": "bin/ns-nonexistent"}\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target in a non-Markdown file under evals/; got: ' + result.combined);
    assert.match(result.combined, /evals\/some\.eval\.json:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('non-Markdown scope: a broken bin/ns-<name> reference in a non-Markdown file under examples/ is caught', () => {
  const { root, cleanup } = buildSyntheticRoot('nonmd-examples', {
    'examples/some-example/notes.txt': 'routes through bin/ns-nonexistent\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target in a non-Markdown file under examples/; got: ' + result.combined);
    assert.match(result.combined, /examples\/some-example\/notes\.txt:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('non-Markdown scope boundary: a non-Markdown file under docs/ or skills/ is NOT scanned (only the seven non-Markdown prefixes are)', () => {
  const { root, cleanup } = buildSyntheticRoot('nonmd-boundary', {
    'docs/reference/notes.txt': 'bin/ns-nonexistent\n',
    'skills/widget-tool/notes.txt': 'bin/ns-nonexistent\n',
    'hooks/lib/clean.mjs': '// nothing interesting here\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a non-Markdown file under docs/ or skills/ must not be scanned; got: ' + result.combined);
    assert.doesNotMatch(result.combined, /ns-nonexistent/, 'the planted references under docs/ and skills/ must never appear as findings');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Fix round 1: a follow-up review found that the degraded (no-git) fallback
// walk previously skipped every dot-prefixed directory entirely, unlike
// git-tracked mode, which never skipped them (git ls-files does not care
// about a dot-prefixed directory name). The two tests below prove the fix
// per scope: the non-Markdown scope now descends into a dot-directory in
// degraded mode (matching git-tracked mode), while the Markdown scope's
// degraded-mode behavior stays exactly as it was before this fix round.
// ---------------------------------------------------------------------------

test('non-Markdown scope: a broken bin/ns-<name> reference under a dot-directory is caught in the degraded (no-git) fallback', () => {
  const { root, cleanup } = buildSyntheticRoot('nonmd-dotdir', {
    'templates/book-scaffold/.studio/notes.mjs': '// bin/ns-nonexistent\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'must exit 1 on a broken routing target under a dot-directory in the degraded fallback; got: ' + result.combined);
    assert.match(result.combined, /templates\/book-scaffold\/\.studio\/notes\.mjs:1:/, 'message must name the planted file and line');
    assert.match(result.combined, /ns-nonexistent/, 'message must name the bogus CLI name verbatim');
  } finally {
    cleanup();
  }
});

test('Markdown scope: a dot-directory stays unscanned in the degraded (no-git) fallback (unchanged from before this fix round)', () => {
  const { root, cleanup } = buildSyntheticRoot('md-dotdir-unchanged', {
    'docs/.hidden/notes.md': 'bin/ns-nonexistent\n',
    'hooks/lib/clean.mjs': '// nothing interesting here\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a .md file under a dot-directory in a Markdown-only prefix must stay unscanned in degraded mode; got: ' + result.combined);
    assert.doesNotMatch(result.combined, /ns-nonexistent/, 'the dot-directory Markdown fixture\'s planted reference must never appear as a finding');
  } finally {
    cleanup();
  }
});

test('non-Markdown scope: false-positive guard, a bare "ns-<name>" mention with no "bin/" prefix in a non-Markdown file is not flagged', () => {
  const { root, cleanup } = buildSyntheticRoot('nonmd-bare-mention', {
    'hooks/lib/thing.mjs': '// a sibling of ns-nonexistent-cli, mentioned here in passing only\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a bare CLI-name mention with no "bin/" prefix in a non-Markdown file must not be flagged; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('tests/ exclusion: a broken bin/ns-<name> reference under a fixture tests/ path stays exit 0', () => {
  const { root, cleanup } = buildSyntheticRoot('nonmd-tests-excluded', {
    'tests/fixtures/thing.mjs': '// routes through bin/ns-nonexistent\n',
    'hooks/lib/clean.mjs': '// nothing interesting here\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a planted reference under a fixture tests/ path must not be scanned; got: ' + result.combined);
    assert.doesNotMatch(result.combined, /ns-nonexistent/, "the tests/ fixture's planted reference must never appear as a finding");
  } finally {
    cleanup();
  }
});

test('binary skip: a non-Markdown file with a NUL byte in its first 8 KB is not scanned', () => {
  const binaryContent = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from('binary marker: bin/ns-nonexistent\n', 'utf8'),
  ]);
  const { root, cleanup } = buildSyntheticRoot('nonmd-binary', {
    'hooks/lib/blob.bin': binaryContent,
    'hooks/lib/clean.mjs': '// nothing interesting here\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a file with a NUL byte in its first 8 KB must be skipped entirely; got: ' + result.combined);
    assert.doesNotMatch(result.combined, /ns-nonexistent/, "the binary file's planted reference must never appear as a finding, even though it follows the NUL byte");
  } finally {
    cleanup();
  }
});

test('summary line reports Markdown and non-Markdown file counts separately', () => {
  const { root, cleanup } = buildSyntheticRoot('nonmd-summary-counts', {
    'bin/ns-widget': '#!/usr/bin/env node\n',
    'skills/widget-tool/SKILL.md': 'Invoke `node "<plugin-root>/bin/ns-widget" --project=. --json`.\n',
    'hooks/lib/clean.mjs': '// nothing interesting here\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'got: ' + result.combined);
    const m = result.combined.match(/pass: (\d+) file\(s\) checked \((\d+) Markdown, (\d+) non-Markdown\)/);
    assert.ok(m, 'pass line must report separate Markdown and non-Markdown counts; got: ' + result.combined);
    const [, total, mdCount, nonMdCount] = m.map(Number);
    assert.equal(mdCount + nonMdCount, total, 'the two reported counts must sum to the total file count');
    assert.ok(mdCount >= 1, 'must count at least the one planted Markdown file');
    assert.ok(nonMdCount >= 1, 'must count at least the planted non-Markdown files');
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
