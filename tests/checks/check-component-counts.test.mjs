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
//                     checker against the actual scan scope and its exemption classes (decision
//                     identifier, dated historical record - both the whole-file form under
//                     docs/adr/ and docs/gates/ and the section-scoped form in CHANGELOG.md and
//                     RELEASE-NOTES.md, historical ordinal).
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

function wordTwo() { return 'tw' + 'o'; }       // "two"
function wordThree() { return 'thr' + 'ee'; }   // "three"
function wordFour() { return 'fo' + 'ur'; }     // "four"
function wordFive() { return 'fi' + 've'; }     // "five"
function wordSeven() { return 'sev' + 'en'; }   // "seven" - the complement of the true CLI count as of the previous growth event
function wordEight() { return 'eig' + 'ht'; }   // "eight" - the complement of the current true CLI count (nine), and not itself a real CLI/skill count anywhere
function wordNine() { return 'nin' + 'e'; }     // "nine" - the true CLI count, ns-claims.md's live claim

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
// and against its exemption classes (decision identifier, dated historical
// record - whole-file under docs/adr/ and docs/gates/, section-scoped in
// CHANGELOG.md and RELEASE-NOTES.md - historical ordinal).
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
    const bogus = wordEight();
    // "nine" assembled - see header comment: ns-claims.md's real, currently-true live claim
    // must never appear contiguous with "shipped CLIs" in this file's own source.
    const liveClaimText = wordNine() + ' shipped CLIs';
    const after = before.split(liveClaimText).join(bogus + ' shipped CLIs');
    assert.notEqual(
      after, before,
      'docs/reference/cli/ns-claims.md must contain the true, live nine-CLI claim for this test to be meaningful'
    );
    writeFileSync(claimsPath, after);

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1 once a live claim is corrupted; got: ' + result.combined);
    assert.match(result.combined, /ns-claims\.md:\d+:/, 'message must name the corrupted file and line');
    assert.match(result.combined, new RegExp(bogus), 'message must name the claimed (bogus) count verbatim');
    assert.match(result.combined, /true counts: 9 CLI\(s\)/, 'message must report the true count (9)');

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
    // Assembled via RegExp(string), not a /regex literal/, matching this file's own stated
    // practice (see header comment): this text is currently safe as a literal only because it
    // is also a genuinely exempt decision-identifier construction, which makes its safety
    // depend on ID_HANDLE_OPEN_RE keeping its current shape - not a dependency worth taking.
    const sameLineHandleRe = new RegExp('\\(D-05, ' + wordFive() + ' shipped CLIs\\)');
    assert.match(sameLineText, sameLineHandleRe, 'agents/fact-checker.md must still carry the same-line D-05 handle for this test to be meaningful');

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

// ---------------------------------------------------------------------------
// Decision-identifier handle recognized through ordinary markdown formatting - fix round 1
// closed a gap where any character between the ID and its handle-opening punctuation defeated
// the exemption entirely. Each test below uses a synthetic root with only 3 real CLIs and a
// claimed handle count of "five" (5 != 3): if the exemption fails to recognize the formatted
// construction, the checker treats it as a live claim and 5 != 3 is a guaranteed false-positive
// finding; if the exemption works, the claim is never even compared to the true count, so the
// mismatch is irrelevant and the checker stays silent either way. This isolates the exemption
// mechanism from the arithmetic entirely.
// ---------------------------------------------------------------------------

function buildIdHandleRoot(label, docContent) {
  return buildSyntheticRoot(label, {
    'bin/ns-a': '#!/usr/bin/env node\n',
    'bin/ns-b': '#!/usr/bin/env node\n',
    'bin/ns-c': '#!/usr/bin/env node\n',
    'skills/widget-skill/SKILL.md': '# widget-skill\n',
    'docs/claim.md': docContent,
  });
}

test('synthetic: a bold-emphasized decision-identifier handle is not flagged', () => {
  const { root, cleanup } = buildIdHandleRoot(
    'id-bold',
    'Governed by D-05 (**' + wordFive() + ' shipped CLIs**), a locked decision name.\n'
  );
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'bold emphasis around the handle must not defeat the exemption; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('synthetic: a backtick-wrapped decision identifier is not flagged', () => {
  const { root, cleanup } = buildIdHandleRoot(
    'id-backtick',
    'Governed by `D-05` (' + wordFive() + ' shipped CLIs), a locked decision name.\n'
  );
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a backtick-wrapped ID must not defeat the exemption; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('synthetic: a colon-joined decision identifier is not flagged', () => {
  const { root, cleanup } = buildIdHandleRoot(
    'id-colon',
    'Governed by D-05: ' + wordFive() + ' shipped CLIs, a locked decision name.\n'
  );
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a colon in place of a paren or comma must not defeat the exemption; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('synthetic: a markdown-linked decision identifier, handle outside the link, is not flagged', () => {
  // Mirrors this repository's own real convention for citing a reference ID as a markdown
  // link - docs/reference/cli/ns-notes.md, ns-status.md, and ns-statusline.md all cite
  // [ADR-0009](../../adr/ADR-0009-apparatus-cli.md) this same way - applied to D-05, which has
  // no such link anywhere in the tree today but uses the identical bracket-then-paren shape.
  const { root, cleanup } = buildIdHandleRoot(
    'id-link',
    'Governed by [D-05](../../adr/ADR-0009-apparatus-cli.md) (' + wordFive() + ' shipped CLIs).\n'
  );
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a markdown-linked ID with the handle outside the link must not defeat the exemption; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('synthetic: an "other N" construction wrapped across two "#"-prefixed comment lines is evaluated correctly, not falsely flagged', () => {
  // Mirrors agents/_chain-permitted.yaml's real "#"-comment convention (an in-scope, shipped
  // file) - fix round 1's Step 4 fix only stripped "//", not "#", so a YAML/shell-style
  // comment-continuation line broke the same exemption bin/ns-statusline's real "//"-wrapped
  // construction needed fixing for. 8 real CLIs here, so "other seven" (7 = 8 - 1) is the
  // arithmetically correct claim; if the "#" strip is missing, the broken exemption falls
  // through to the live-claim path and 7 != 8 is a guaranteed false-positive finding.
  const { root, cleanup } = buildSyntheticRoot('other-hash-wrap', {
    'bin/ns-a': '#!/usr/bin/env node\n',
    'bin/ns-b': '#!/usr/bin/env node\n',
    'bin/ns-c': '#!/usr/bin/env node\n',
    'bin/ns-d': '#!/usr/bin/env node\n',
    'bin/ns-e': '#!/usr/bin/env node\n',
    'bin/ns-f': '#!/usr/bin/env node\n',
    'bin/ns-g': '#!/usr/bin/env node\n',
    'bin/ns-h': '#!/usr/bin/env node\n',
    'skills/widget-skill/SKILL.md': '# widget-skill\n',
    'templates/example.yaml': '# This tool differs from the other\n# ' + wordSeven() + ' CLIs in one respect: it is read-only.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a "#"-wrapped other-N construction that is arithmetically correct must not be flagged; got: ' + result.combined);
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

test('real-repo scope: whole-file dated historical records (docs/adr/, docs/gates/) are never scanned', () => {
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

// ---------------------------------------------------------------------------
// Gap A / Gap B - fix round 2 closed two formatting shapes that could still false-positive the
// decision-identifier exemption (PF-15, count checker exemption gaps), plus the section-scoped
// dated-heading toggle protecting CHANGELOG.md and RELEASE-NOTES.md (PF-16, changelog path
// protection). All eight fixtures below use an 8-CLI synthetic root, matching the true CLI count
// this repository ships today, so a mismatched claim ("seven" vs 8) is unambiguously a live
// finding unless a structural exemption correctly applies.
// ---------------------------------------------------------------------------

function buildEightCliSyntheticRoot(label, files) {
  return buildSyntheticRoot(label, {
    'bin/ns-a': '#!/usr/bin/env node\n',
    'bin/ns-b': '#!/usr/bin/env node\n',
    'bin/ns-c': '#!/usr/bin/env node\n',
    'bin/ns-d': '#!/usr/bin/env node\n',
    'bin/ns-e': '#!/usr/bin/env node\n',
    'bin/ns-f': '#!/usr/bin/env node\n',
    'bin/ns-g': '#!/usr/bin/env node\n',
    'bin/ns-h': '#!/usr/bin/env node\n',
    'skills/widget-skill/SKILL.md': '# widget-skill\n',
    ...files,
  });
}

// Gap A: the handle-opening parenthetical itself wrapped as a markdown link's label, e.g.
// "D-05 ([five shipped CLIs](url))". The candidate match starts INSIDE the link label, so the
// preceding-text window only ever contains the truncated opening "D-05 ([" - the link's own
// closing "](url)" comes after the match and is never part of the window, so the full-link
// resolution in normalizeMarkdown (which needs both the closing "]" and the trailing "(url)")
// never fires, and the exemption regex sees a dangling "[" instead of the "(" it expects.
// Mutation proof: removing the trailing normalizeMarkdown `.replace(/\[\s*$/, '')` step turns
// this from exit 0 (exempt) back into exit 1 (false positive) - confirmed by hand, restored.
test('synthetic: gap A - a decision-identifier handle whose parenthetical is itself a markdown link is not flagged', () => {
  const { root, cleanup } = buildEightCliSyntheticRoot('gapA-positive', {
    'docs/claim.md': 'Governed by D-05 ([' + wordFive() + ' shipped CLIs](url)), a locked decision name.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a handle-shaped parenthetical wrapped as a markdown link must still be recognized; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// Gap A guard: proves the ID requirement in ID_HANDLE_OPEN_RE is load-bearing, not merely the
// trailing-bracket strip alone. "Note:" is not a decision-identifier shape, so a handle-looking
// count phrase written the same way must still be caught. Mutation proof: making the leading ID
// token optional in ID_HANDLE_OPEN_RE flips this from exit 1 to exit 0 - confirmed by hand,
// restored. A same-shape fixture with a real ID present (the test above) does NOT distinguish
// this mutation, because it stays exempt either way; this fixture is the one that does.
test('synthetic: gap A guard - a handle-shaped count phrase with no real decision identifier is still caught', () => {
  const { root, cleanup } = buildEightCliSyntheticRoot('gapA-guard', {
    'docs/claim.md': 'Note: [' + wordSeven() + ' shipped CLIs](url) exist.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'a live claim shaped like a link-wrapped handle, with no real ID present, must still be caught; got: ' + result.combined);
    assert.match(result.combined, /docs\/claim\.md:1:/, 'must name the planted file and line');
  } finally {
    cleanup();
  }
});

// Gap B: a decision-identifier handle wrapping across TWO line breaks (ID on one line, its
// opening punctuation alone on the next, the count phrase only on the third) - the shape a
// single-previous-line join cannot see. Mutation proof: reverting the bounded backward walk to
// the original single-previous-line join flips this from exit 0 (exempt) to exit 1 (false
// positive) - confirmed by hand, restored.
test('synthetic: gap B - a decision-identifier handle wrapping across two line breaks is not flagged', () => {
  const { root, cleanup } = buildEightCliSyntheticRoot('gapB-positive', {
    'docs/claim.md': 'Governed by D-05\n(\n' + wordSeven() + ' shipped CLIs) exist today.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'an ID / punctuation / count-phrase wrap across two line breaks must still be recognized; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// Gap B guard: proves the backward walk's blank-line stop is load-bearing, not merely widening
// the window count. A blank line between the ID and the count phrase is a real paragraph break, so
// this must never be bridged even though it falls within the 3-line join budget. Mutation proof:
// deleting the `priorLine.trim() === ''` stop flips this from exit 1 to exit 0 - confirmed by
// hand, restored.
test('synthetic: gap B guard - a blank line between the ID and the count phrase is never bridged', () => {
  const { root, cleanup } = buildEightCliSyntheticRoot('gapB-guard', {
    'docs/claim.md': 'Governed by D-05 (\n\n' + wordSeven() + ' shipped CLIs) exist today.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'a paragraph break between the ID and the count phrase must never be silently bridged; got: ' + result.combined);
    assert.match(result.combined, /docs\/claim\.md:3:/, 'must name the planted file and line');
  } finally {
    cleanup();
  }
});

// CHANGELOG.md / RELEASE-NOTES.md section-scoped dated-heading toggle (PF-16). A stale claim
// under a dated release heading is a historical record and must be exempt; a stale claim under
// any other heading (CHANGELOG.md's "## Unreleased" in any of its forms, or RELEASE-NOTES.md's
// permanent meta sections) is live and must still be caught. Mutation proof: removing the
// `inHistoricalSection = true` branch flips this from exit 0 to exit 1 - confirmed by hand,
// restored.
test('CHANGELOG.md: a stale claim under a dated release heading is exempt (section-scoped, not file-scoped)', () => {
  const { root, cleanup } = buildEightCliSyntheticRoot('changelog-dated', {
    'CHANGELOG.md':
      '# Changelog\n\n## Unreleased\n\n### Fixed\n\n- nothing yet\n\n## 1.0.0 - 2026-08-21\n\n### Fixed\n\n- This release ships ' +
      wordSeven() + ' shipped CLIs total, a stale historical snapshot.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'a stale claim under a dated release heading must be exempt as a historical record; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// Proves the fail-open risk this checker must not have: the canonical Keep a Changelog
// compare-link "## [Unreleased](url)" heading form must reset the toggle back to live just like
// the plain form does, even after a preceding dated section. Mutation proof: removing the
// `CHANGELOG_LIVE_HEADING_RE` reset branch flips this from exit 1 to exit 0 - confirmed by hand,
// restored.
test('CHANGELOG.md: a stale claim under a compare-link "## [Unreleased](...)" heading, after a dated section, is still caught', () => {
  const { root, cleanup } = buildEightCliSyntheticRoot('changelog-unreleased-link', {
    'CHANGELOG.md':
      '# Changelog\n\n## 1.0.0 - 2026-08-21\n\n### Fixed\n\n- Historical note, correctly ignored.\n\n' +
      '## [Unreleased](https://example.com/compare/v0.1.0...HEAD)\n\n### Fixed\n\n- A live claim: ' +
      wordSeven() + ' shipped CLIs, which must still be caught.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'a live claim under a compare-link Unreleased heading must still be caught, not silently exempted; got: ' + result.combined);
    assert.match(result.combined, /CHANGELOG\.md:\d+:/, 'must name the planted file and line');
  } finally {
    cleanup();
  }
});

// RELEASE-NOTES.md gets the same section-scoped toggle, not a blanket path exemption: a dated
// release section is exempt, but the maintainer runbook section beneath it - a live, permanent
// section this file always carries, and the section GitHub publishes verbatim as the release
// body - is still checked. Mutation proof: removing 'RELEASE-NOTES.md' from
// CHANGELOG_SCOPED_FILES flips the dated section's claim from silently exempt to also flagged
// (2 findings instead of 1) - confirmed by hand, restored.
test('RELEASE-NOTES.md: a dated release section is exempt but the maintainer runbook section beneath it is still checked', () => {
  const { root, cleanup } = buildEightCliSyntheticRoot('release-notes-both', {
    'RELEASE-NOTES.md':
      '# Release Notes\n\n## 1.0.0 - 2026-08-21\n\nA historical claim of ' + wordSeven() +
      ' shipped CLIs, correctly ignored.\n\n## Cutting a release (maintainer runbook)\n\nA live claim: ' +
      wordSeven() + ' shipped CLIs, which must still be caught.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'the live claim under the runbook section must be caught; got: ' + result.combined);
    const findingLines = result.combined.split('\n').filter((l) => l.includes('RELEASE-NOTES.md'));
    assert.equal(findingLines.length, 1, 'exactly one finding expected (the runbook line), not the dated section too; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// Fenced code state must be tracked separately from heading state: a documented worked example
// that itself shows a dated heading shape (RELEASE-NOTES.md's real "Format of a release entry"
// section does exactly this) must never toggle the rest of the file to exempt. Mutation proof:
// removing the FENCE_MARKER_RE branch flips this from exit 1 to exit 0 - confirmed by hand,
// restored.
test('CHANGELOG.md: a fenced worked example containing a dated heading never toggles the file to exempt', () => {
  const { root, cleanup } = buildEightCliSyntheticRoot('changelog-fence-guard', {
    'CHANGELOG.md':
      '# Changelog\n\n## Unreleased\n\nExample section shape:\n\n```markdown\n## 0.2.0 - 2026-01-01\n\n' +
      'A worked example, not a real dated section.\n```\n\nA live claim right after the fence: ' +
      wordSeven() + ' shipped CLIs, must still be caught.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'a live claim following a fenced dated-heading example must still be caught; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// "the other N CLIs" is a genuine live claim about the complement (true value = trueCount - 1),
// not a blanket exemption - fix round 1 closed a gap where it was skipped unconditionally, which
// silently missed exactly the sites (bin/ns-notes, bin/ns-statusline, hooks/lib/status-
// engine.mjs) a previous wave's four human sweeps also missed. Both directions are proven below,
// per F6 (checker negative tests): an assertion checked in only one direction is not proof.

test('synthetic: a correct "other N" claim (N = trueCount - 1) is not flagged', () => {
  const { root, cleanup } = buildSyntheticRoot('other-correct', {
    'bin/ns-a': '#!/usr/bin/env node\n',
    'bin/ns-b': '#!/usr/bin/env node\n',
    'bin/ns-c': '#!/usr/bin/env node\n',
    'skills/widget-skill/SKILL.md': '# widget-skill\n',
    'docs/claim.md': 'This CLI is unlike the other ' + wordTwo() + ' CLIs in the project.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'three real CLIs means the true complement is two; "other two" must pass; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

test('synthetic: a stale "other N" claim (N != trueCount - 1) is caught, naming claimed, expected, and total', () => {
  const { root, cleanup } = buildSyntheticRoot('other-stale', {
    'bin/ns-a': '#!/usr/bin/env node\n',
    'bin/ns-b': '#!/usr/bin/env node\n',
    'bin/ns-c': '#!/usr/bin/env node\n',
    'skills/widget-skill/SKILL.md': '# widget-skill\n',
    'docs/claim.md': 'This CLI is unlike the other ' + wordFour() + ' CLIs in the project.\n',
  });
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'three real CLIs means the true complement is two, not four; must be caught; got: ' + result.combined);
    assert.match(result.combined, /docs\/claim\.md:1:/, 'must name the file and line');
    assert.match(result.combined, new RegExp(wordFour()), 'must name the claimed (bogus) complement verbatim');
    assert.match(result.combined, /2 other CLIs/, 'must name the true complement (2)');
    // Assembled via RegExp(string) - see the wrapped-handle test above for why.
    const trueTotalRe = new RegExp('3' + ' CLIs total');
    assert.match(result.combined, trueTotalRe, 'must name the true total (3), not only the complement');
  } finally {
    cleanup();
  }
});

test('real-repo scope: bin/ns-statusline\'s real "the other eight CLIs" (currently correct) is not flagged', () => {
  const { root, cleanup } = cloneRealRepo('real-other-n-correct');
  try {
    const statuslineCliText = readFileSync(join(root, 'bin', 'ns-statusline'), 'utf8');
    // Assembled via RegExp(string) - see the wrapped-handle test above for why.
    const otherEightClisRe = new RegExp('the other\\s*\\n\\/\\/\\s*' + wordEight() + ' CLIs');
    assert.match(
      statuslineCliText, otherEightClisRe,
      'bin/ns-statusline must still carry the LINE-WRAPPED other-precedes-count construction for this test to be meaningful'
    );

    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'eight is the correct complement of the true 9-CLI total; got: ' + result.combined);
    assert.doesNotMatch(result.combined, /ns-statusline\b/, 'a correct other-N claim must never be flagged');
  } finally {
    cleanup();
  }
});

test('real-repo scope: a deliberately corrupted "other N" claim in bin/ns-notes is caught', () => {
  const { root, cleanup } = cloneRealRepo('real-other-n-stale');
  try {
    const notesPath = join(root, 'bin', 'ns-notes');
    const before = readFileSync(notesPath, 'utf8');
    const liveClaimText = 'other ' + wordEight() + ' CLIs';
    const bogus = wordThree();
    const after = before.split(liveClaimText).join('other ' + bogus + ' CLIs');
    assert.notEqual(after, before, 'bin/ns-notes must contain the real "other eight CLIs" claim for this test to be meaningful');
    writeFileSync(notesPath, after);

    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 1, 'a corrupted other-N claim must be caught; got: ' + result.combined);
    assert.match(result.combined, /ns-notes:\d+:/, 'must name the corrupted file and line');
    assert.match(result.combined, new RegExp(bogus), 'must name the claimed (bogus) complement verbatim');
    assert.match(result.combined, /9 CLIs total/, 'must name the true total (9), not only the complement');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Forward-growth simulation: the real acceptance test for fix round 1. Adding one CLI to a
// clean clone (no other edit) simulates the next real growth event and asks what the checker
// actually does at that instant, rather than only what a hand-picked planted fixture proves.
// Before this fix round, this simulation caught 3 real sites and silently missed 3 more - the
// other-N-CLIs self-referential comments in bin/ns-notes, bin/ns-statusline, and
// hooks/lib/status-engine.mjs, exactly the shape a previous wave's four human sweeps also
// missed. Running it against the round-1 fix turned up a SEVENTH real site the coordinator's
// own enumeration had not named: docs/reference/cli/ns-statusline.md:20 carries the identical
// other-N-CLIs construction in prose form, and the fixed checker catches it too - a
// finding from running the simulation, not from re-reading the coordinator's list, which is the
// point of running a simulation instead of only a curated set of planted cases.
//
// One expected, non-shipped side effect of cloning the FULL repo (this test file included) and
// then mutating it: this file's own explanatory prose necessarily quotes real numbers to
// describe and test against the REAL, unmodified tree's true CLI count - correctly, as the
// "real-repo scope: the current tree has no stale component-count claims" test above proves
// (this file included, since it is committed and therefore part of that scan too). Once this
// simulation mutates the SAME clone's true count up by one, those same quotes necessarily read
// as stale relative to the mutated clone, which is not a tree defect - it never happens against
// the real, unmutated repository - so those findings are filtered out below rather than asserted
// on, and the shipped-site count is asserted precisely instead. A ninth real CLI (ns-overlap)
// has since shipped for real, not simulated, so this simulation now exercises growth from nine
// to ten rather than eight to nine; the real sites and their count (8) are unchanged by that
// shift, only the literal numbers embedded in this test's own assertions are.
// ---------------------------------------------------------------------------

test('forward-growth simulation: adding a tenth CLI to a real-repo clone catches all eight real sites that go stale', () => {
  const { root, cleanup } = cloneRealRepo('growth-simulation');
  try {
    const before = runClonedChecker(root, SCRIPT);
    assert.equal(before.status, 0, 'the clone must start clean, matching the real tree; got: ' + before.combined);

    // The only change: one new CLI, no other edit. Content is inert (no count-shaped text of
    // its own), so every finding below is caused by the true CLI count moving from 9 to 10.
    writeFile(root, 'bin/ns-zzz-simulated-growth', '#!/usr/bin/env node\n');

    const after = runClonedChecker(root, SCRIPT);
    assert.equal(after.status, 1, 'adding a tenth CLI must turn real sites stale; got: ' + after.combined);
    assert.match(after.combined, /true counts: 10 CLI\(s\)/, 'must derive the new true count (10) from the tree, not a constant');

    const errorLines = after.combined.split('\n').filter((l) => l.includes(' ERROR: '));
    const shippedErrorLines = errorLines.filter((l) => !l.includes('check-component-counts.test.mjs'));

    // The one direct "N shipped CLIs" claim a prior review already proved this checker
    // catches (never regressed by this fix round).
    assert.ok(shippedErrorLines.some((l) => l.includes('ns-claims.md:')), 'must still catch docs/reference/cli/ns-claims.md\'s direct "nine shipped CLIs" claim; got: ' + after.combined);

    // hooks/lib/bible.mjs's used-by line was rewritten (PF-10 (bible.mjs importer counts)) from
    // a bare count naming how many of the shipped command-line tools were covered, alongside a
    // separate bare importer total, to a rule ("every CLI under bin/ imports this directly
    // except ns-statusline"), which carries no
    // number-plus-noun shape for CANDIDATE_RE to match. Growing the true CLI count must not
    // manufacture a finding here, the same way it must not leave a stale one behind.
    const bibleFindings = shippedErrorLines.filter((l) => l.includes('bible.mjs'));
    assert.equal(bibleFindings.length, 0, 'hooks/lib/bible.mjs\'s used-by line is rule-based, not count-based, so it must produce no findings even as the CLI count grows; got: ' + after.combined);

    // The four other-N-CLIs sites fix round 1 exists to close (three code comments the
    // coordinator named, plus the docs/reference/cli/ns-statusline.md prose instance the
    // simulation itself turned up) - all silently missed before this round.
    assert.ok(shippedErrorLines.some((l) => l.includes('ERROR: bin/ns-notes:')), 'must catch bin/ns-notes\'s "the other eight CLIs" now that the true complement is nine; got: ' + after.combined);
    assert.ok(shippedErrorLines.some((l) => l.includes('ERROR: bin/ns-statusline:')), 'must catch bin/ns-statusline\'s LINE-WRAPPED "the other eight CLIs" now that the true complement is nine; got: ' + after.combined);
    assert.ok(shippedErrorLines.some((l) => l.includes('ERROR: hooks/lib/status-engine.mjs:')), 'must catch hooks/lib/status-engine.mjs\'s "the other eight CLIs" now that the true complement is nine; got: ' + after.combined);
    assert.ok(shippedErrorLines.some((l) => l.includes('ERROR: docs/reference/cli/ns-statusline.md:')), 'must catch the prose "the other eight CLIs" instance in docs/reference/cli/ns-statusline.md too - the extra real site this simulation found; got: ' + after.combined);

    // The three README sites, added when the README was rewritten as a full front page.
    // All three are deliberately written in the shape this checker matches, including the
    // shields.io badge, whose ALT TEXT carries the claim in matchable form ("9 CLIs")
    // precisely so the badge line is covered: the checker cannot see the count inside the
    // badge URL itself ("badge/CLIs-9-..."), so an alt text written as "CLIs: 9" would
    // have left the most visible count in the repository silently unenforced.
    const readmeFindings = shippedErrorLines.filter((l) => l.includes('ERROR: README.md:'));
    assert.equal(readmeFindings.length, 3,
      'must catch all three README count claims (the badge alt text, the catalog heading, ' +
      'and the status table row); a drop to two means one of them was rephrased into a ' +
      'shape this checker cannot see, which is the exact failure the alt text is written ' +
      'to avoid; got: ' + after.combined);

    assert.equal(shippedErrorLines.length, 8, 'must report exactly the eight real shipped sites that go stale on this growth event, no more and no fewer; got: ' + after.combined);
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
