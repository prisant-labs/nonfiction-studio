// tests/engines/stylometry-calibration-engine.test.mjs
// what-it-is:   the test suite for the deterministic voice-drift calibration engine
//               (hooks/lib/stylometry-calibration.mjs, ADR-0012 voice verdict scope)
// what-it-does: exercises calibrateBaseline against synthetic voice corpora built in this file --
//               a contraction- and first-person-heavy corpus (expected to land in the "chapter"
//               regime, since ghostwriteTransform has real, consistent signal to remove) and a
//               formal third-person corpus with zero first-person pronouns and zero contractions
//               (expected to land in "book", since ghostwriteTransform is a syntactic no-op on it
//               and the resulting positive/negative classes are statistically indistinguishable).
//               Determinism, the block_threshold-is-a-quantile relationship, the noise_scales
//               shape, ghostwriteTransform's own hand-computable behavior, and the too-small-
//               corpus guard are each covered by a dedicated test.
//               NOTE ON INDEPENDENCE: the "block_threshold equals the quantile of its evaluation
//               max|z| set" test deliberately does NOT import any quantile function from the
//               module under test -- it defines its own copy of the nearest-rank formula in this
//               file. The module's internal quantile function is not exported for exactly this
//               reason: importing it here would let a broken quantile implementation grade its
//               own homework (the test's "independent" recomputation would use the same broken
//               function calibrateBaseline used internally, and the two would always agree even
//               when both are wrong). See that test below for the replay mechanics.
// why:          TDD for Task 2 of the ADR-0012 implementation wave; this file is additive (the
//               pre-existing tests/engines/stylometry-calibration.test.mjs is a different, older
//               suite scoped to the drift-budget recalibration and is out of this file's scope).
// runner:       node --test tests/engines/*.test.mjs (also tests/engines/*.test.mjs is glob-picked
//               up by scripts/test-engines.mjs)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { countWords, measureChapter, CURRENT_MARKER_SET_VERSION } from '../../hooks/lib/stylometry-engine.mjs';
import {
  calibrateBaseline, mulberry32, splitSentences, draw, signedDeviation, ghostwriteTransform,
  CorpusTooSmallError, CALIBRATION_SPANS, CALIBRATION_REPLICATES, MIN_CALIBRATION_WORDS,
  DEFAULT_SEED, REGIME_AUC_THRESHOLD,
} from '../../hooks/lib/stylometry-calibration.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'ns-stylometry');

// ---------------------------------------------------------------------------
// Synthetic corpora
// ---------------------------------------------------------------------------
//
// Both corpora are built from the same 15 topics so their sentence counts and structure are
// directly comparable; only the register differs. Both comfortably clear MIN_CALIBRATION_WORDS
// (checked by an assertion below, so a future edit that shrinks either corpus below the guard
// fails loudly here rather than surfacing as a confusing failure in an unrelated test).

const TOPICS = [
  'listening to new hires', 'running the weekly retro', 'writing the onboarding guide',
  'mentoring junior engineers', 'reviewing pull requests', 'planning the roadmap',
  'debugging the payment flow', 'teaching the workshop', 'presenting at the town hall',
  'coaching the new manager', 'closing out the quarter', 'hiring for the open role',
  'refactoring the legacy module', 'negotiating the vendor contract', 'setting the annual budget',
];

// Contraction- and first-person-pronoun-heavy prose: ghostwriteTransform has real, consistent
// signal to remove here (contraction_rate and first_person_rate both collapse toward zero on
// every transformed draw), so this corpus is expected to calibrate into the "chapter" regime.
function richSentencesFor(topic) {
  return [
    "I've always found " + topic + " harder than it looks, and I'm still learning.",
    "We're the kind of team that doesn't skip " + topic + " just because it's inconvenient.",
    "My honest take on " + topic + " is that I've never fully mastered it.",
    "I don't think we've ever agreed on the right way to handle " + topic + ".",
    "Our approach to " + topic + " isn't perfect, but I'm proud of how far we've come.",
    "I'm usually the one who ends up owning " + topic + ", and I wouldn't have it any other way.",
    "We've learned that " + topic + " goes better when we're honest about what isn't working.",
    "I can't pretend I've enjoyed every minute of " + topic + ", but it's taught me a lot.",
    "You'd think " + topic + " would get easier, but I'm not sure it ever does.",
    "I remember the first time I tried " + topic + ", and I'm glad we didn't give up on it.",
    "It's rare that I finish " + topic + " without wishing we'd started earlier.",
    "We shouldn't have waited so long to fix how we handle " + topic + ", but here we are.",
    "I've noticed that I'm calmer about " + topic + " than I used to be, and I like that.",
    "We're not the only ones who've struggled with " + topic + ", and that's oddly comforting.",
    "I wish I'd written down what I learned about " + topic + " the first time around.",
    "Our team doesn't always get " + topic + " right, but we're getting better, and I'm grateful.",
  ];
}

// Formal third-person prose with zero contractions and zero first-person pronouns:
// ghostwriteTransform's regex substitutions have nothing to match here, so a ghostwritten draw
// is syntactically identical in distribution to an untransformed one. Expected to calibrate into
// the "book" regime (detectability AUC near 0.5, well under REGIME_AUC_THRESHOLD).
function plainSentencesFor(topic) {
  return [
    "The practice of " + topic + " has evolved considerably across the organization.",
    "Researchers examining " + topic + " have documented several distinct approaches.",
    "Historical records concerning " + topic + " reveal a complex pattern of change.",
    "A committee tasked with " + topic + " typically meets on a quarterly basis.",
    "The department responsible for " + topic + " published a lengthy internal report.",
    "Analysts studying " + topic + " tend to disagree about the underlying causes.",
    "The manual describing " + topic + " was revised twice during the fiscal year.",
    "Observers noted that " + topic + " improved gradually over several quarters.",
    "The policy governing " + topic + " was drafted by a cross-functional working group.",
    "Surveys concerning " + topic + " suggest opinions vary widely across regions.",
    "The proposal addressing " + topic + " received mixed reviews from the committee.",
    "A subsequent audit of " + topic + " identified several areas for improvement.",
    "The initiative surrounding " + topic + " was later expanded to additional teams.",
    "External consultants reviewing " + topic + " recommended a phased rollout.",
    "The steering group overseeing " + topic + " circulated a revised timeline.",
    "Documentation covering " + topic + " was consolidated into a single reference.",
  ];
}

const RICH_CORPUS = TOPICS.flatMap(richSentencesFor).join(' ');
const PLAIN_CORPUS = TOPICS.flatMap(plainSentencesFor).join(' ');
const TINY_CORPUS = 'This corpus is deliberately far too small to calibrate anything at all. '
  + 'It has only a couple of short sentences in it, well under the floor. '
  + 'Nothing in it should ever be enough to satisfy the minimum word requirement.';

// Review round 1 (empirically confirmed finding): countWords tolerates unpunctuated prose as
// "words" -- it just matches letter sequences -- but splitSentences requires a terminal . ! or ?
// and discards anything else. A comma-joined word list with no sentence-ending punctuation
// anywhere clears MIN_CALIBRATION_WORDS on word count alone while yielding ZERO usable sentences,
// which crashed calibrateBaseline (see the module's calibrateBaseline JSDoc and the guard right
// after buildSentencePool for the fix).
const PUNCTUATION_FREE_WORDS = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet',
  'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango',
  'uniform', 'victor', 'whiskey', 'xray', 'yankee', 'zulu', 'amber', 'birch', 'cedar', 'willow',
];
const PUNCTUATION_FREE_CORPUS = Array.from(
  { length: 2400 }, (_, i) => PUNCTUATION_FREE_WORDS[i % PUNCTUATION_FREE_WORDS.length]
).join(', ');

assert.ok(countWords(RICH_CORPUS) >= MIN_CALIBRATION_WORDS,
  'test setup: RICH_CORPUS must clear MIN_CALIBRATION_WORDS');
assert.ok(countWords(PLAIN_CORPUS) >= MIN_CALIBRATION_WORDS,
  'test setup: PLAIN_CORPUS must clear MIN_CALIBRATION_WORDS');
assert.ok(countWords(TINY_CORPUS) < MIN_CALIBRATION_WORDS,
  'test setup: TINY_CORPUS must stay below MIN_CALIBRATION_WORDS');
assert.ok(countWords(PUNCTUATION_FREE_CORPUS) >= MIN_CALIBRATION_WORDS,
  'test setup: PUNCTUATION_FREE_CORPUS must clear MIN_CALIBRATION_WORDS on word count alone -- ' +
  'the whole point is that the word-count guard passes and a DIFFERENT guard must catch it');

// ---------------------------------------------------------------------------
// Shared fixtures: computed once at module load, reused across several tests below rather than
// re-running the (multi-second) full calibration for each assertion. richResultA / richResultB
// are two SEPARATE calibrateBaseline calls on identical inputs, which is what the determinism
// test compares.
// ---------------------------------------------------------------------------

const richResultA = calibrateBaseline([RICH_CORPUS], { seed: DEFAULT_SEED });
const richResultB = calibrateBaseline([RICH_CORPUS], { seed: DEFAULT_SEED });

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('calibrateBaseline is deterministic for a fixed seed: two calls on identical input produce byte-identical JSON', () => {
  assert.strictEqual(JSON.stringify(richResultB), JSON.stringify(richResultA),
    'two calibrateBaseline calls with identical inputs and seed must serialize identically');
});

test('calibrateBaseline defaults seed to DEFAULT_SEED (4242) when opts.seed is omitted: the default path equals an explicit seed:4242 call, byte-for-byte', () => {
  const result = calibrateBaseline([RICH_CORPUS]);
  assert.strictEqual(DEFAULT_SEED, 4242, 'DEFAULT_SEED must be exactly 4242 per the pinned recipe');
  assert.strictEqual(JSON.stringify(result), JSON.stringify(richResultA),
    'omitting opts.seed must produce output byte-identical to an explicit seed: 4242 call, not merely a matching seed field');
});

// ---------------------------------------------------------------------------
// Schema shape
// ---------------------------------------------------------------------------

test('calibration.spans is exactly the five-rung ladder [550, 1100, 2200, 4400, 8800]', () => {
  assert.deepStrictEqual(richResultA.calibration.spans, [550, 1100, 2200, 4400, 8800]);
  assert.deepStrictEqual(CALIBRATION_SPANS, [550, 1100, 2200, 4400, 8800]);
});

test('calibration.replicates is exactly CALIBRATION_REPLICATES (1000), not a caller-supplied value', () => {
  assert.strictEqual(richResultA.calibration.replicates, CALIBRATION_REPLICATES);
  assert.strictEqual(CALIBRATION_REPLICATES, 1000);
});

test('noise_scales carry all eight markers with positive finite values, at every rung', () => {
  const markerNames = Object.keys(richResultA.markers);
  assert.strictEqual(markerNames.length, 8, 'the baseline vector must carry exactly eight markers');
  for (const span of CALIBRATION_SPANS) {
    const scales = richResultA.calibration.noise_scales[String(span)];
    assert.ok(scales, 'noise_scales must be present for rung ' + span);
    assert.deepStrictEqual(Object.keys(scales).sort(), [...markerNames].sort(),
      'rung ' + span + ' noise_scales must carry exactly the eight measured markers');
    for (const marker of markerNames) {
      const v = scales[marker];
      assert.ok(Number.isFinite(v) && v > 0,
        'rung ' + span + ' marker ' + marker + ' noise scale must be a positive finite number; got ' + v);
    }
  }
});

test('block_thresholds carry a positive finite number for every rung', () => {
  for (const span of CALIBRATION_SPANS) {
    const t = richResultA.calibration.block_thresholds[String(span)];
    assert.ok(Number.isFinite(t) && t > 0,
      'rung ' + span + ' block_threshold must be a positive finite number; got ' + t);
  }
});

test('markers is the full-corpus vector, matching measureChapter on the same single-text input', () => {
  assert.deepStrictEqual(richResultA.markers, measureChapter(RICH_CORPUS),
    'calibrateBaseline\'s markers field must be exactly what --measure would produce on the same input');
});

// ---------------------------------------------------------------------------
// block_threshold really is the 0.99 quantile of its rung's evaluation max|z| set
// ---------------------------------------------------------------------------
//
// This replays the RNG stream calibrateBaseline consumed for the rung-0 (span 550) calibration
// and evaluation blocks: the calibration block is replayed and discarded (only its position in
// the stream matters -- the noise scales it fits are already covered by the test above), then the
// evaluation block is replayed and independently scored using calibrateBaseline's OWN reported
// noise scales for span 550, and the resulting max|z| set is independently quantiled (see the
// file header for why this file defines its own quantile formula rather than importing the
// module's).

function independentNearestRankQuantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

test('span-550 block_threshold equals the independently-recomputed 0.99 quantile of its evaluation max|z| set', () => {
  const span = CALIBRATION_SPANS[0];
  const sentences = splitSentences(RICH_CORPUS);
  const weights = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const rng = mulberry32(DEFAULT_SEED);

  // Replay and discard the calibration block, to advance the stream to the same position
  // calibrateBaseline was at when it started drawing the evaluation block.
  for (let i = 0; i < CALIBRATION_REPLICATES; i += 1) {
    draw(sentences, weights, span, rng, null);
  }

  // Replay the evaluation block and independently score it.
  const scales = richResultA.calibration.noise_scales[String(span)];
  const zScores = [];
  for (let i = 0; i < CALIBRATION_REPLICATES; i += 1) {
    const text = draw(sentences, weights, span, rng, null);
    const dev = signedDeviation(richResultA.markers, measureChapter(text));
    const maxZ = Math.max(...Object.keys(dev).map((m) => Math.abs(dev[m] / scales[m])));
    zScores.push(maxZ);
  }

  const expected = independentNearestRankQuantile(zScores, 0.99);
  assert.strictEqual(richResultA.calibration.block_thresholds[String(span)], expected,
    'block_threshold for span ' + span + ' must equal the independently-recomputed 0.99 quantile');
});

// ---------------------------------------------------------------------------
// Regime: chapter vs. book, driven by two corpora with detectability on opposite sides of the bar
// ---------------------------------------------------------------------------

test('regime is "chapter" when detectability AUC >= REGIME_AUC_THRESHOLD (contraction- and first-person-rich corpus)', () => {
  assert.ok(richResultA.calibration.detectability_auc >= REGIME_AUC_THRESHOLD,
    'expected the rich corpus\'s detectability AUC to clear the bar; got ' + richResultA.calibration.detectability_auc);
  assert.strictEqual(richResultA.calibration.regime, 'chapter');
});

test('regime is "book" when detectability AUC < REGIME_AUC_THRESHOLD (formal third-person corpus with no first person or contractions)', () => {
  const plainResult = calibrateBaseline([PLAIN_CORPUS], { seed: DEFAULT_SEED });
  assert.ok(plainResult.calibration.detectability_auc < REGIME_AUC_THRESHOLD,
    'expected the plain corpus\'s detectability AUC to fall short of the bar; got ' + plainResult.calibration.detectability_auc);
  assert.strictEqual(plainResult.calibration.regime, 'book');
});

test('REGIME_AUC_THRESHOLD is exactly 0.95', () => {
  assert.strictEqual(REGIME_AUC_THRESHOLD, 0.95);
});

// ---------------------------------------------------------------------------
// ghostwriteTransform: hand-computable cases
// ---------------------------------------------------------------------------

test('ghostwriteTransform expands contractions and shifts first-person pronouns to third-person plural', () => {
  // "don't" -> "don" (the 't suffix maps to '', per the documented crude/mechanical transform,
  // not a grammar-aware "do not"); "we're" -> "we are"; then "I" -> "They" (capitalized) and
  // "we" -> "they" (lowercase), case-preserved per original word.
  assert.strictEqual(
    ghostwriteTransform("I don't think we're ready for this."),
    'They don think they are ready for this.'
  );
});

test('ghostwriteTransform: a second hand-computed case covering the \'ve contraction and the first-person-plural possessive "our"', () => {
  // "I've" -> "I have" -> "They have"; "our" -> "their".
  assert.strictEqual(
    ghostwriteTransform("I've kept our promise."),
    'They have kept their promise.'
  );
});

test('ghostwriteTransform is a no-op on prose with no contractions and no first-person pronouns', () => {
  const sentence = 'The committee reviewed the proposal and issued a formal response.';
  assert.strictEqual(ghostwriteTransform(sentence), sentence);
});

// ---------------------------------------------------------------------------
// Too-small-corpus guard
// ---------------------------------------------------------------------------

test('a corpus below MIN_CALIBRATION_WORDS throws CorpusTooSmallError naming the found and needed word counts', () => {
  const found = countWords(TINY_CORPUS);
  assert.throws(
    () => calibrateBaseline([TINY_CORPUS], { seed: DEFAULT_SEED }),
    (err) => {
      assert.ok(err instanceof CorpusTooSmallError, 'must throw CorpusTooSmallError specifically');
      assert.strictEqual(err.name, 'CorpusTooSmallError');
      assert.strictEqual(err.exitCode, 1, 'the CLI turns this into exit 1, not exit 2');
      assert.ok(err.message.includes(String(found)),
        'message must name the found word count (' + found + '); got: ' + err.message);
      assert.ok(err.message.includes(String(MIN_CALIBRATION_WORDS)),
        'message must name the needed word count (' + MIN_CALIBRATION_WORDS + '); got: ' + err.message);
      return true;
    }
  );
});

test('review round 1: a corpus that clears MIN_CALIBRATION_WORDS but yields zero usable (terminally-punctuated) sentences throws CorpusTooSmallError, not a raw TypeError', () => {
  assert.throws(
    () => calibrateBaseline([PUNCTUATION_FREE_CORPUS], { seed: DEFAULT_SEED }),
    (err) => {
      assert.ok(err instanceof CorpusTooSmallError,
        'must throw the typed CorpusTooSmallError, not let an unhandled TypeError from ' +
        'ghostwriteTransform(undefined) escape');
      assert.strictEqual(err.name, 'CorpusTooSmallError');
      assert.strictEqual(err.exitCode, 1);
      assert.ok(err.message.includes('0 sentences'),
        'message must name the found sentence count (0); got: ' + err.message);
      assert.ok(err.message.toLowerCase().includes('terminal'),
        'message must name what "usable" means here (terminal punctuation); got: ' + err.message);
      return true;
    }
  );
});

test('MIN_CALIBRATION_WORDS is exactly 2200 (2x the 1100-word canonical rung)', () => {
  assert.strictEqual(MIN_CALIBRATION_WORDS, 2200);
});

// ---------------------------------------------------------------------------
// CLI: bin/ns-stylometry --calibrate=<path>[,<path>...]
// ---------------------------------------------------------------------------
//
// End-to-end spawnSync tests, matching this repo's own CLI-test convention (see
// tests/engines/quick-scan-measure.test.mjs and tests/engines/status-cli.test.mjs): a temp file
// outside the repo, spawnSync(process.execPath, [BIN, ...]), cleanup in a finally block.

function runCalibrate(filePath) {
  return spawnSync(process.execPath, [BIN, '--calibrate=' + filePath], { encoding: 'utf8' });
}

test('CLI --calibrate: two runs on the same file produce byte-identical stdout, and stdout parses into exactly the five documented keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ns-calibrate-test-'));
  const tmpFile = join(dir, 'voice-corpus.md');
  writeFileSync(tmpFile, RICH_CORPUS, 'utf8');

  try {
    const first = runCalibrate(tmpFile);
    const second = runCalibrate(tmpFile);
    assert.strictEqual(first.status, 0, 'stderr: ' + first.stderr);
    assert.strictEqual(second.status, 0, 'stderr: ' + second.stderr);
    assert.strictEqual(second.stdout, first.stdout,
      'two --calibrate runs on the same input file must produce byte-identical stdout');

    const out = JSON.parse(first.stdout);
    assert.deepStrictEqual(
      Object.keys(out).sort(),
      ['calibration', 'files', 'markers', 'marker_set_version', 'totalWords'].sort(),
      '--calibrate stdout must carry exactly these five top-level keys, no more'
    );
    assert.strictEqual(out.marker_set_version, CURRENT_MARKER_SET_VERSION,
      'marker_set_version must equal the engine constant by reference, not a hardcoded literal');
    assert.strictEqual(out.calibration.regime, 'chapter');
    assert.strictEqual(out.totalWords, countWords(RICH_CORPUS));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --calibrate: stderr states the regime and the reason in two separate sentences (honest disclosure)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ns-calibrate-test-'));
  const tmpFile = join(dir, 'voice-corpus.md');
  writeFileSync(tmpFile, RICH_CORPUS, 'utf8');

  try {
    const result = runCalibrate(tmpFile);
    assert.strictEqual(result.status, 0, 'stderr: ' + result.stderr);
    assert.match(result.stderr, /regime = chapter\./,
      'first sentence must plainly state the regime');
    assert.match(result.stderr, /Detectability AUC 1\.000 at the 550-word rung meets the 0\.95 bar/,
      'second sentence must plainly state why, naming the measured AUC and the bar');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --calibrate: a too-small corpus exits 1 with the plain-language message on stderr and empty stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ns-calibrate-test-'));
  const tmpFile = join(dir, 'tiny.md');
  writeFileSync(tmpFile, TINY_CORPUS, 'utf8');

  try {
    const result = runCalibrate(tmpFile);
    assert.strictEqual(result.status, 1, 'too-small corpus must exit 1, not 0 or 2; stderr: ' + result.stderr);
    assert.strictEqual(result.stdout, '', 'stdout must be empty on the error path');
    assert.match(result.stderr, /at least 2200/,
      'stderr must name the needed word count');
    assert.match(result.stderr, new RegExp(String(countWords(TINY_CORPUS))),
      'stderr must name the found word count');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --calibrate: review round 1 -- a corpus with words but zero usable sentences exits 1 with the plain-language message, not a raw stack trace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ns-calibrate-test-'));
  const tmpFile = join(dir, 'punctuation-free.md');
  writeFileSync(tmpFile, PUNCTUATION_FREE_CORPUS, 'utf8');

  try {
    const result = runCalibrate(tmpFile);
    assert.strictEqual(result.status, 1,
      'must exit 1 via the documented typed-error path, not crash with an unhandled TypeError; stderr: ' + result.stderr);
    assert.strictEqual(result.stdout, '', 'stdout must be empty on the error path');
    assert.match(result.stderr, /0 sentences/,
      'stderr must name the found sentence count (0)');
    assert.doesNotMatch(result.stderr, /TypeError/,
      'stderr must be the plain-language message, not a raw stack trace');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --calibrate: missing file argument exits 2 with a usage message on stderr', () => {
  const result = spawnSync(process.execPath, [BIN, '--calibrate=' + join(REPO_ROOT, 'does-not-exist-xyz.md')], { encoding: 'utf8' });
  assert.strictEqual(result.status, 2);
  assert.match(result.stderr, /cannot read file/);
});
