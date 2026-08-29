// tests/checks/check-self-sufficiency.test.mjs
// what-it-is:   planted-violation tests for scripts/check-self-sufficiency.mjs
// what-it-does: runs the real checker script (a standalone script, invoked directly - never
//               through scripts/lib/registry.mjs's check(ctx) pattern) against temp clones of
//               the tracked tree, with a violation planted into the clone only. Covers the
//               ANTHROPIC_API_KEY class (waivable only via scripts/self-sufficiency-exceptions.json)
//               and the non-Anthropic provider-key class (never waivable) both in the
//               pre-existing scan scope and in examples/, which F7 (scan-set blind spots) added
//               to the scanned set; proves the narrowed carve-out still exempts raw network
//               calls under examples/ (the carve-out that was, and remains, actually justified by
//               "a sample book legitimately contains prose about sources and URLs"); and proves
//               the doc-misleading-phrase class (class 5) survives paraphrase without
//               false-positiving on this repo's own negated self-sufficiency guarantees -
//               PF-22 (checker coverage shapes) widening 3.
// why:          F6 (checker negative tests) - "a checker that cannot fail is not a checker";
//               F7 (scan-set blind spots) - examples/ needs a test proving it is genuinely
//               scanned for provider-key patterns now, not just declared scanned; PF-22 (checker
//               coverage shapes) widening 3 - five literal phrases catch nothing once an author
//               paraphrases them, and a naive widening would flag this repo's own README.md
//               guarantees that it needs none of what class 5 forbids.
// runner:       node --test "tests/checks/*.test.mjs"

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cloneRepoToTemp, runClonedChecker, cleanupGoldenClone, snapshotPaths, diffPathSnapshots } from './clone-helper.mjs';

const SCRIPT = 'scripts/check-self-sufficiency.mjs';

// Built from parts so this file's own tracked source never contains the forbidden
// substrings check-self-sufficiency.mjs scans for as contiguous text -- the same
// reason that checker excludes its own source and scripts/checks/mcp-valid.mjs from
// self-scanning ("every forbidden literal it looks for necessarily appears in this
// file too"). Planting a violation for a test necessarily means the violation's
// exact text exists somewhere; building it at runtime, once, here, keeps it out of
// the git-tracked bytes of this file while the CLONE still receives the real,
// fully-joined string the checker is supposed to catch.
const ANTHROPIC_KEY_NAME = ['ANTHROPIC', 'API', 'KEY'].join('_');
const OPENAI_KEY_NAME = ['OPENAI', 'API', 'KEY'].join('_');
const FETCH_CALL = ['fetch', '('].join('');

after(() => {
  cleanupGoldenClone();
});

// ---------------------------------------------------------------------------
// Working-tree-untouched proof, matching check-plugin-root.test.mjs's
// content-hash-snapshot pattern (see clone-helper.mjs's header comment for
// why a whole-tree snapshot and a `git status` check both give false
// positives in this wave's actively shared tree). Scoped to exactly the
// live-repo paths this file's plant steps target (all of them new,
// hence-never-tracked files).
// ---------------------------------------------------------------------------

const WATCHED_LIVE_PATHS = [
  'scripts/_f6-planted-anthropic-key.mjs', // must never come into existence live
  'scripts/_f6-planted-openai-key.mjs',
  'scripts/_f6-planted-network-call.mjs',
  'examples/_f6-planted-openai-key.md',
  'examples/_f6-planted-network-mention.md',
  'docs/_f6-planted-misleading-flag.md',
  'docs/_f6-planted-misleading-pass.md',
];

const beforeWatchedSnapshot = snapshotPaths(WATCHED_LIVE_PATHS);

after(() => {
  const diff = diffPathSnapshots(beforeWatchedSnapshot, snapshotPaths(WATCHED_LIVE_PATHS));
  assert.deepEqual(
    diff, [],
    'the live repo paths this file plants into must be unchanged after every clone/plant/run; diff: ' + diff.join(', ')
  );
});

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

test('clean clone: an unmodified temp clone (widened scope included) still exits 0', () => {
  const { root, cleanup } = cloneRepoToTemp('selfsuff-clean');
  try {
    const result = runClonedChecker(root, SCRIPT);
    assert.equal(result.status, 0, 'must exit 0 on a clean clone; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Pre-existing scan scope: bin/, hooks/, scripts/, agents/, skills/,
// templates/, docs/, .github/workflows/, tests/, evals/, .claude-plugin/,
// .codex-plugin/, and root-level files were already scanned before F7.
// ---------------------------------------------------------------------------

test('pre-existing scope: an ANTHROPIC_API_KEY reference with no exceptions-file entry is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('selfsuff-anthropic-key');
  try {
    const target = join(root, 'scripts', '_f6-planted-anthropic-key.mjs');
    writeFileSync(target, 'const key = process.env.' + ANTHROPIC_KEY_NAME + ';\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /scripts\/_f6-planted-anthropic-key\.mjs/, 'message must name the planted file');
    assert.match(result.combined, new RegExp(ANTHROPIC_KEY_NAME), 'message must name the planted pattern');
    assert.match(result.combined, /no exceptions-file entry/, 'message must say why it is forbidden');
  } finally {
    cleanup();
  }
});

test('pre-existing scope: a raw network call (the fetch pattern) with no exceptions-file entry is caught', () => {
  // Item 7 (fix wave): the only pre-existing NETWORK_PATTERNS test proves the examples/
  // exemption still applies (a network call under examples/ stays exempt); nothing proved a
  // network call OUTSIDE examples/ is actually caught, so emptying NETWORK_PATTERNS entirely
  // passed the whole suite. This test closes that gap.
  const { root, cleanup } = cloneRepoToTemp('selfsuff-network-preexisting');
  try {
    const target = join(root, 'scripts', '_f6-planted-network-call.mjs');
    writeFileSync(target, 'async function loadRemote() { return await ' + FETCH_CALL + "'https://example.com/data'); }\n");

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /scripts\/_f6-planted-network-call\.mjs/, 'message must name the planted file');
    assert.match(result.combined, /raw network call/, 'message must name the violation type');
  } finally {
    cleanup();
  }
});

test('pre-existing scope: a non-Anthropic provider key is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('selfsuff-openai-key-preexisting');
  try {
    const target = join(root, 'scripts', '_f6-planted-openai-key.mjs');
    writeFileSync(target, 'const key = process.env.' + OPENAI_KEY_NAME + ';\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /scripts\/_f6-planted-openai-key\.mjs/, 'message must name the planted file');
    assert.match(result.combined, new RegExp(OPENAI_KEY_NAME), 'message must name the planted pattern');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Widened scan scope (F7 (scan-set blind spots)): examples/ was not scanned at
// all before F7. A green result here is proof the widening genuinely covers
// examples/ for provider-key patterns, not just that the checker still works
// somewhere it always worked.
// ---------------------------------------------------------------------------

test('widened scope: a non-Anthropic provider key planted under examples/ is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('selfsuff-openai-key-examples');
  try {
    const target = join(root, 'examples', '_f6-planted-openai-key.md');
    writeFileSync(target, 'Planted for F6/F7: ' + OPENAI_KEY_NAME + ' should never appear in shipped or example content.\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    assert.match(result.combined, /examples\/_f6-planted-openai-key\.md/, 'message must name the planted file');
    assert.match(result.combined, new RegExp(OPENAI_KEY_NAME), 'message must name the planted pattern');
  } finally {
    cleanup();
  }
});

test('widened scope: a raw network call planted under examples/ remains exempt (narrowed carve-out preserved)', () => {
  const { root, cleanup } = cloneRepoToTemp('selfsuff-network-examples');
  try {
    const target = join(root, 'examples', '_f6-planted-network-mention.md');
    writeFileSync(target, "This chapter's example code calls " + FETCH_CALL + "url) to illustrate the API the memoirist built.\n");

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 0, 'network patterns must remain exempt under examples/; got: ' + result.combined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Class 5 (doc-misleading phrases): paraphrase survival and negation guard,
// PF-22 (checker coverage shapes) widening 3. The five literal phrases were
// replaced by pattern classes (requirement-of-credential, paid-service) plus
// a negation guard, so this table proves three things at once: the five
// original phrases still catch (regression), new paraphrases of them catch
// too, and a negated clause, including this repo's own real README.md:332
// guarantee, is not flagged as the thing it denies. Two clones, not a
// mixed one: a shared clone would let a should-pass line hide inside a file
// that also contains should-flag lines, so a per-file exit-code assertion
// would pass even if the passing lines were never actually reachable by the
// checker's docs/** scope. Two dedicated files, one all-should-flag and one
// all-should-pass, make the exit code itself the assertion.
// ---------------------------------------------------------------------------

const MISLEADING_FLAG_CASES = [
  { label: 'original: requires an api key', text: 'This tool requires an API key to function.' },
  { label: 'original: you must set your api key', text: 'You must set your API key before running this.' },
  { label: 'original: sign up for a paid', text: 'Sign up for a paid plan to unlock this feature.' },
  { label: 'original: purchase a license', text: 'You must purchase a license to continue.' },
  { label: 'original: subscription is required', text: 'A subscription is required for full access.' },
  { label: 'paraphrase: an API key is required', text: 'An API key is required to use this tool.' },
  { label: 'paraphrase: you need an API key', text: 'You need an API key to proceed.' },
  { label: 'paraphrase: you will need an access token', text: 'You will need an access token to authenticate.' },
  { label: 'paraphrase: requires a paid subscription', text: 'This feature requires a paid subscription.' },
  { label: 'paraphrase: must purchase a license', text: 'You must purchase a license for commercial use.' },
  { label: 'paraphrase: sign up for a paid plan', text: 'Sign up for a paid plan to continue.' },
];

const MISLEADING_PASS_CASES = [
  { label: 'negation: requires no API key', text: 'This tool requires no API key.' },
  { label: 'negation: no API key is required', text: 'No API key is required to use this tool.' },
  { label: 'negation: without an API key', text: 'You can run this without an API key.' },
  { label: 'negation: never requires a credential', text: 'This plugin never requires a credential.' },
  { label: 'negation: zero API keys needed', text: 'Zero API keys needed to get started.' },
  {
    label: 'negation: none require a separate API key (real README.md:332 clause)',
    text: 'None of them call a model API directly, and none require a separate API key, account, or paid service.',
  },
];

test('doc-misleading phrase (class 5): every original phrase and paraphrase case is caught', () => {
  const { root, cleanup } = cloneRepoToTemp('selfsuff-misleading-flag');
  try {
    const target = join(root, 'docs', '_f6-planted-misleading-flag.md');
    writeFileSync(target, MISLEADING_FLAG_CASES.map((c) => c.text).join('\n') + '\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 1, 'must exit 1; got: ' + result.combined);
    MISLEADING_FLAG_CASES.forEach((c, i) => {
      const lineNo = i + 1;
      const re = new RegExp('docs/_f6-planted-misleading-flag\\.md:' + lineNo + ':.*doc-misleading phrase');
      assert.match(result.combined, re, c.label + ' (line ' + lineNo + ') must be caught; got: ' + result.combined);
    });
  } finally {
    cleanup();
  }
});

test('doc-misleading phrase (class 5): negation guard passes every negated case, including the real README.md:332 clause', () => {
  const { root, cleanup } = cloneRepoToTemp('selfsuff-misleading-pass');
  try {
    const target = join(root, 'docs', '_f6-planted-misleading-pass.md');
    writeFileSync(target, MISLEADING_PASS_CASES.map((c) => c.text).join('\n') + '\n');

    const result = runClonedChecker(root, SCRIPT);

    assert.equal(result.status, 0, 'negated guarantees must not be flagged; got: ' + result.combined);
    assert.doesNotMatch(
      result.combined,
      /_f6-planted-misleading-pass\.md/,
      'no line in the negation file should be named as a finding; got: ' + result.combined
    );
  } finally {
    cleanup();
  }
});
