// tests/checks/check-component-counts.test.mjs
// what-it-is:   planted-violation tests for scripts/checks/check-component-counts.mjs
// what-it-does: runs the real checker script (a standalone process, invoked directly, not a
//               check(ctx) module) against isolated fixtures, with every planted violation
//               confined to a temp clone or a from-scratch synthetic root - never the live
//               working tree. Two fixture styles, both reused from
//               tests/checks/check-skill-cli-targets.test.mjs's own established split:
//                 (1) synthetic fixtures (buildSyntheticRoot below): a from-scratch temp
//                     directory carrying only a fresh copy of this repo's CURRENT on-disk
//                     checker script plus invented bin/ and skills/ content, so detection, the
//                     "derives from the tree" property, and the multiple-findings property can
//                     all be proven without depending on this repo's real shipped components;
//                 (2) real-repo clones (clone-helper.mjs's cloneRepoToTemp), which exercise the
//                     checker against the actual scan scope and its three real exemption classes
//                     (decision identifier, dated historical record, historical ordinal).
//               Every planted count in this file is assembled from string parts at runtime
//               (never written as a contiguous literal), the same discipline
//               check-skill-cli-targets.test.mjs uses for its bogus CLI name
//               ('ns-statu' + 'z'): this file lives under tests/, which is itself inside the
//               checker's own scan scope, so a literal stale-count phrase written directly in
//               this source would be a real finding the next time the checker runs for real
//               against this repository.
// why:          F6 (checker negative tests) - "a checker that cannot fail is not a checker";
//               these are the durable, permanent proof the checker has real teeth, not only a
//               one-time manual run.
// runner:       node --test "tests/checks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, REPO_ROOT } from './clone-helper.mjs';

const SCRIPT = 'scripts/checks/check-component-counts.mjs';

after(() => {
  cleanupGoldenClone();
});

// ---------------------------------------------------------------------------
// Number-word assembly helpers: build a count phrase at runtime from parts,
// so the assembled phrase never appears as contiguous text in this file's
// own source (see header comment).
// ---------------------------------------------------------------------------

function wordThree() { return 'thr' + 'ee'; }   // "three"
function wordFour() { return 'fo' + 'ur'; }     // "four"
function wordFive() { return 'fi' + 've'; }     // "five"
function wordSeven() { return 'sev' + 'en'; }   // "seven"
function wordEight() { return 'eig' + 'ht'; }   // "eight" - the true CLI count, ns-claims.md's live claim
function wordNine() { return 'nin' + 'e'; }     // "nine" - not a real CLI/skill count anywhere

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

function writeFile(root, relPath, content) {
  const dst = join(root, ...relPath.split('/'));
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, content);
}

/**
 * Builds a from-scratch temp directory carrying a fresh copy of this repo's CURRENT on-disk
 * checker script, plus caller-supplied bin/, skills/, and prose content. Not derived from the
 * real tracked tree at all, so assertions here are never contaminated by anything already
 * present in this repo's real component counts.
 */
function buildSyntheticRoot(label, files) {
  const root = mkdtempSync(join(tmpdir(), 'nonfiction-component-counts-synth-' + label + '-'));
  copyFromRepo(root, SCRIPT);
  for (const [relPath, content] of Object.entries(files)) {
    writeFile(root, relPath, content);
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
// Synthetic fixtures: derivation, detection, multiple findings
// ---------------------------------------------------------------------------

test('clean synthetic fixture (claim matches the true CLI count) exits 0', () => {
  const { root, cleanup } = buildSyntheticRoot('clean', {
    'bin/ns-a': '#!/usr/bin/env node\n',
    'bin/ns-b': '#!/usr/bin/env node\n',
    'bin/ns-c': '#!/usr/bin/env node\n',
    'skills/widget-skill/SKILL.md': '# widget-skill\n',
    'docs/claim.md': 'This plugin ships ' + wordThree() + ' CLIs under bin/.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'must exit 0 when the claim matches the true count; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('a deliberately wrong CLI-count claim is caught, naming file, line, claimed, and true count', () => {
  const { root, cleanup } = buildSyntheticRoot('wrong-count', {
    'bin/ns-a': '#!/usr/bin/env node\n',
    'bin/ns-b': '#!/usr/bin/env node\n',
    'bin/ns-c': '#!/usr/bin/env node\n',
    'skills/widget-skill/SKILL.md': '# widget-skill\n',
    'docs/claim.md': 'This plugin ships ' + wordFive() + ' CLIs under bin/.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1 on a stale count claim; got: ' + result.combined);
    assert.match(result.combined, /docs\/claim\.md:1:/, 'message must name the planted file and line');
    assert.match(result.combined, new RegExp(wordFive()), 'message must name the claimed count verbatim');
    assert.match(result.combined, /\b3\b/, 'message must name the true count (3)');
  } finally {
    cleanup();
  }
});

test('two separate stale claims (CLI and skill) are both reported, not only the first', () => {
  const { root, cleanup } = buildSyntheticRoot('multi', {
    'bin/ns-a': '#!/usr/bin/env node\n',
    'bin/ns-b': '#!/usr/bin/env node\n',
    'skills/widget-skill/SKILL.md': '# widget-skill\n',
    'docs/cli-claim.md': 'This plugin ships ' + wordNine() + ' CLIs under bin/.\n',
    'docs/skill-claim.md': 'This plugin ships ' + wordFour() + ' skills under skills/.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1 when any claim is stale; got: ' + result.combined);
    assert.match(result.combined, /docs\/cli-claim\.md:1:/, 'must name the CLI-count finding');
    assert.match(result.combined, /docs\/skill-claim\.md:1:/, 'must name the skill-count finding, not stop at the first');
    assert.match(result.combined, /2 finding\(s\) found/, 'must report exactly two findings, one per stale claim');
  } finally {
    cleanup();
  }
});

test('the true count is derived from the tree: adding a CLI moves the verdict with no checker edit', () => {
  const { root, cleanup } = buildSyntheticRoot('derive', {
    'bin/ns-a': '#!/usr/bin/env node\n',
    'bin/ns-b': '#!/usr/bin/env node\n',
    'bin/ns-c': '#!/usr/bin/env node\n',
    'skills/widget-skill/SKILL.md': '# widget-skill\n',
    'docs/claim.md': 'This plugin ships ' + wordThree() + ' CLIs under bin/.\n',
  });
  try {
    const before = runClonedChecker(root, SCRIPT);
    assert.equal(before.status, 0, 'claim of three must match three real CLIs before the addition; got: ' + before.combined);
    assert.match(before.combined, /true counts: 3 CLI\(s\)/, 'must report the derived true CLI count as 3 before the addition');

    // Add a fourth CLI to the SAME root. The checker script and docs/claim.md are untouched.
    writeFile(root, 'bin/ns-d', '#!/usr/bin/env node\n');

    const after = runClonedChecker(root, SCRIPT);
    assert.equal(after.status, 1, 'the same claim of three must now be stale against four real CLIs; got: ' + after.combined);
    assert.match(after.combined, /true counts: 4 CLI\(s\)/, 'must report the derived true CLI count as 4 after the addition, with no checker code change');
    assert.match(after.combined, new RegExp(wordThree() + ' CLIs'), 'the finding must show the now-stale claimed value');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Real-repo integration: proves the mechanism against the actual scan scope,
// and against its three exemption classes (decision identifier, dated
// historical record, historical ordinal).
// ---------------------------------------------------------------------------

test('real-repo scope: the current tree has no stale component-count claims', () => {
  const { root, cleanup } = cloneRealRepo('real-clean');
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'the real, current tree must have no stale component-count claims; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('real-repo scope: a deliberately corrupted live claim in ns-claims.md is caught', () => {
  const { root, cleanup } = cloneRealRepo('real-claims-corrupted');
  try {
    const claimsPath = join(root, 'docs', 'reference', 'cli', 'ns-claims.md');
    const before = readFileSync(claimsPath, 'utf8');
    const bogus = wordNine();
    // "eight" assembled - see header comment: ns-claims.md's real, currently-true live claim
    // must never appear contiguous with "shipped CLIs" in this file's own source.
    const liveClaimText = wordEight() + ' shipped CLIs';
    const after = before.split(liveClaimText).join(bogus + ' shipped CLIs');
    assert.notEqual(
      after, before,
      'docs/reference/cli/ns-claims.md must contain the true, live eight-CLI claim for this test to be meaningful'
    );
    writeFileSync(claimsPath, after);

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1 once a live claim is corrupted; got: ' + result.combined);
    assert.match(result.combined, /ns-claims\.md:\d+:/, 'message must name the corrupted file and line');
    assert.match(result.combined, new RegExp(bogus), 'message must name the claimed (bogus) count verbatim');
    assert.match(result.combined, /true counts: 8 CLI\(s\)/, 'message must report the true count (8)');

    // The adjacent decision-identifier handle on the same line, "D-05 (five shipped CLIs via
    // bin/)", must still resolve as exempt even after the live claim beside it is corrupted -
    // exactly one finding for this file, not two.
    const findingLines = result.combined.split('\n').filter((l) => l.includes('ns-claims.md'));
    assert.equal(findingLines.length, 1, 'exactly one finding expected for ns-claims.md, not the adjacent D-05 handle too; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('real-repo scope: decision-identifier handles are never flagged, including one that line-wraps', () => {
  const { root, cleanup } = cloneRealRepo('real-id-handle');
  try {
    const sameLinePath = join(root, 'agents', 'fact-checker.md');
    const sameLineText = readFileSync(sameLinePath, 'utf8');
    assert.match(sameLineText, /\(D-05, five shipped CLIs\)/, 'agents/fact-checker.md must still carry the same-line D-05 handle for this test to be meaningful');

    const wrappedPath = join(root, 'docs', 'reference', 'agents', 'fact-checker.md');
    const wrappedText = readFileSync(wrappedPath, 'utf8');
    // Built via RegExp(string) rather than a /regex literal/: this file lives in the checker's
    // own scan scope (see header comment), and this exact decision-identifier handle text,
    // written contiguously, would itself be a live finding once this file is committed.
    const wrappedHandleRe = new RegExp('\\(D-05,\\r?\\n\\s*' + wordFive() + ' shipped CLIs\\)');
    assert.match(wrappedText, wrappedHandleRe, 'docs/reference/agents/fact-checker.md must still carry the LINE-WRAPPED D-05 handle for this test to be meaningful');

    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'got: ' + result.combined);
    assert.doesNotMatch(result.combined, /fact-checker\.md/, 'neither the same-line nor the line-wrapped D-05 handle may ever be flagged');
  } finally {
    cleanup();
  }
});

test('real-repo scope: historical-ordinal claims are never flagged', () => {
  const { root, cleanup } = cloneRealRepo('real-ordinal');
  try {
    const statusText = readFileSync(join(root, 'docs', 'reference', 'cli', 'ns-status.md'), 'utf8');
    assert.match(statusText, /is the eighth CLI shipped/, 'ns-status.md must still carry its ordinal claim for this test to be meaningful');
    const statuslineText = readFileSync(join(root, 'docs', 'reference', 'cli', 'ns-statusline.md'), 'utf8');
    assert.match(statuslineText, /is the sixth CLI shipped/, 'ns-statusline.md must still carry its ordinal claim for this test to be meaningful');

    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'got: ' + result.combined);
    assert.doesNotMatch(result.combined, /ns-status\.md/, 'the ordinal claim in ns-status.md must never be flagged');
    assert.doesNotMatch(result.combined, /ns-statusline\.md/, 'the ordinal claim in ns-statusline.md must never be flagged');
  } finally {
    cleanup();
  }
});

test('real-repo scope: dated historical records (docs/adr/, docs/gates/) are never scanned', () => {
  const { root, cleanup } = cloneRealRepo('real-historical');
  try {
    const adrText = readFileSync(join(root, 'docs', 'adr', 'ADR-0005-bin-path-windows.md'), 'utf8');
    // Assembled via RegExp(string) - see the wrapped-handle test above for why.
    const adrFiveClisRe = new RegExp('The ' + wordFive() + ' CLIs ship as extensionless Node scripts');
    assert.match(adrText, adrFiveClisRe, 'ADR-0005 must still carry its present-tense five-CLI claim (5 vs the true 8) for this test to be meaningful');
    const gateText = readFileSync(join(root, 'docs', 'gates', 'phase-1-gate.md'), 'utf8');
    const gateCountsRe = new RegExp('8 agents, ' + '11' + ' skills, ' + '5' + ' CLIs');
    assert.match(gateText, gateCountsRe, 'phase-1-gate.md must still carry its stale-relative-to-today count for this test to be meaningful');

    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'got: ' + result.combined);
    assert.doesNotMatch(result.combined, /ADR-0005/, 'docs/adr/** must never be scanned for component-count claims');
    assert.doesNotMatch(result.combined, /phase-1-gate\.md/, 'docs/gates/** must never be scanned for component-count claims');
  } finally {
    cleanup();
  }
});

test('real-repo scope: "the other N CLIs" self-referential claims are not flagged', () => {
  const { root, cleanup } = cloneRealRepo('real-other-n');
  try {
    const statuslineCliText = readFileSync(join(root, 'bin', 'ns-statusline'), 'utf8');
    // Assembled via RegExp(string) - see the wrapped-handle test above for why.
    const otherSevenClisRe = new RegExp('the other\\s*\\n\\/\\/\\s*' + wordSeven() + ' CLIs');
    assert.match(
      statuslineCliText, otherSevenClisRe,
      'bin/ns-statusline must still carry the LINE-WRAPPED other-precedes-count construction for this test to be meaningful'
    );

    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'got: ' + result.combined);
    assert.doesNotMatch(result.combined, /ns-statusline\b/, 'the other-precedes-count construction must never be flagged');
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
// coverage from any test above. A sibling checker's git-tracked code path
// once shipped with no automated coverage for exactly this reason; this
// test is the permanent proof of that path, mirroring
// check-skill-cli-targets.test.mjs's own final test: it runs the real,
// current on-disk checker script directly against REPO_ROOT itself (no
// clone, no copy), which necessarily has real git metadata. The checker
// only ever reads files and git output and writes to stdout/stderr, so
// running it in place against the live repo makes no filesystem change.
// ---------------------------------------------------------------------------

test('git-tracked mode: running the checker in place against this repo\'s real .git engages git-tracked mode, not the degraded fallback', () => {
  const result = runClonedChecker(REPO_ROOT, SCRIPT);
  assert.equal(result.status, 0, 'the real, current tree must have no stale component-count claims; got: ' + result.combined);
  assert.match(
    result.combined, /mode: git-tracked/,
    'must report git-tracked mode, not degraded mode, when run in place against a real checkout; got: ' + result.combined
  );
  assert.doesNotMatch(
    result.combined, /filesystem-walk/,
    'must not fall back to the degraded filesystem-walk path when real git metadata is present; got: ' + result.combined
  );
});

test('filesystem-walk fallback mode: a synthetic root with no .git still scans correctly', () => {
  const { root, cleanup } = buildSyntheticRoot('fallback-mode', {
    'bin/ns-a': '#!/usr/bin/env node\n',
    'skills/widget-skill/SKILL.md': '# widget-skill\n',
    'docs/claim.md': 'This plugin ships ' + wordNine() + ' CLIs under bin/.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.match(result.combined, /filesystem-walk/, 'a from-scratch root with no .git must engage the fallback walk; got: ' + result.combined);
    assert.equal(result.status, 1, 'the fallback walk must still find the planted violation; got: ' + result.combined);
    assert.match(result.combined, /docs\/claim\.md:1:/, 'the fallback walk must still name the file and line');
  } finally {
    cleanup();
  }
});
