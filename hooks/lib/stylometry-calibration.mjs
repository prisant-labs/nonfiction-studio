// what-it-is:   the deterministic voice-drift calibration engine (ADR-0012, voice verdict scope)
// what-it-does: measures a five-rung noise-scale and block-threshold ladder from an author's own
//               voice corpus, plus the chapter-vs-book regime call, so a later drift verdict is
//               judged against a null distribution measured on the SAME voice rather than an
//               assumed constant. For each rung span in CALIBRATION_SPANS, one calibration block
//               of resampled same-voice draws fixes that rung's per-marker noise scale (the
//               standard deviation of each marker's signed relative deviation from the full-
//               corpus baseline); a second, disjoint evaluation block at the same span is scored
//               against that noise scale and its empirical 0.99 quantile of max|z| becomes the
//               rung's block_threshold (targeting roughly a 1 percent false-block rate on unseen
//               same-voice text). Every block for every rung is drawn from ONE continuously
//               advancing seeded stream, never rewound, so no calibration draw is ever reused as
//               an evaluation draw. At the shortest rung, a further block of the same draws is run
//               through ghostwriteTransform (below) to synthesize a positive class; the Mann-
//               Whitney AUC between that class and the shortest rung's evaluation negatives decides
//               whether a per-chapter verdict is statistically supportable (the "chapter" regime)
//               or whether only a book-scale aggregate is (the "book" regime).
// why:          a single stored threshold, measured at one span and adjusted by a sqrt(span) law
//               for every other span, was measured (this implementation wave's own design probe)
//               to under-predict the true null away from its calibration point -- and an
//               under-predicted null means excess false blocks, the defect ADR-0012 exists to
//               cure. A per-span ladder with no cross-span adjustment carries no such structural
//               error mode; every rung is calibrated and evaluated on its own disjoint data.
//               Regime derivation: the design probe measured two genuine-prose sources as reliably
//               distinguishable at chapter length (detectability AUC 0.968 and 0.993) and a source
//               with a sparse first-person voice as not (AUC 0.707); the 0.95 bar separates the two
//               groups cleanly, so it is what REGIME_AUC_THRESHOLD ships as.
// used-by:      bin/ns-stylometry (--calibrate mode); the voice-capture path writes calibrateBaseline's
//               output into stylometry.baseline.calibration in .studio/config.json
//
// Methodology note: mulberry32 (seeded RNG), the markdown-to-sentence pipeline, the weighted
// same-voice resampling draw, and the signed-relative-deviation and Mann-Whitney AUC statistics
// below are the same measurement methodology this implementation wave's design probe used to
// settle the ladder shape and the regime bar; nothing here reinvents that math, only packages it
// as shipped product code with a schema-shaped (marker-keyed, string-span-keyed) output instead of
// the probe's ad hoc arrays and console tables.

import { measureChapter, measureBook, countWords } from './stylometry-engine.mjs';

// ---------------------------------------------------------------------------
// Pinned design constants (ADR-0012 implementation wave)
// ---------------------------------------------------------------------------

// Five calibration rungs, in words. Interpolation between rungs (linear in ln(span_words))
// and end-clamping beyond either end are computeDrift's responsibility, not this module's --
// calibrateBaseline only ever measures AT these exact spans.
export const CALIBRATION_SPANS = [550, 1100, 2200, 4400, 8800];

// Replicates per calibration/evaluation block, at every rung. Fixed, not a caller knob: the
// statistics this ladder is built from (the empirical 0.99 quantile, the Mann-Whitney AUC) were
// only validated at this replicate count, and a smaller count would silently ship an under-
// measured null. Exported so tests can reference it by name instead of a duplicated literal.
export const CALIBRATION_REPLICATES = 1000;

// Default seed. A caller may override it via calibrateBaseline's second argument, but every
// shipped baseline uses this value unless a future task decides otherwise.
export const DEFAULT_SEED = 4242;

// The regime bar (P4): detectability AUC at the shortest rung must meet or exceed this to call
// the "chapter" regime; below it, only "book" is supportable. See the file header for the
// measured citation values this bar was chosen against.
export const REGIME_AUC_THRESHOLD = 0.95;

// Minimum usable word count (summed via countWords, the engine's canonical tokenizer, over every
// input text) before calibration can run at all. This is 2x the 1100-word rung -- the CANONICAL
// rung, not the top of the ladder -- and it does not scale with the top rung (8800 words). That is
// deliberate, not an oversight: every draw above is a WEIGHTED RESAMPLE WITH REPLACEMENT from the
// same sentence pool, so a small corpus can legitimately produce an 8800-word draw by reusing its
// own sentences many times over; this implementation wave's design probe validated exactly that
// shape, drawing large-span samples with replacement from sources far smaller than the span being
// drawn, with no evidence the resampling guard was ever cut short. What a small corpus cannot do is
// supply enough DISTINCT material for the calibration and evaluation blocks to say anything about
// natural same-voice variation in the first place; 2200 words is the floor below which that
// variation measurement itself is not trustworthy, independent of how large a span is later drawn
// from it.
export const MIN_CALIBRATION_WORDS = 2200;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Typed error for a voice corpus too small to calibrate (fewer than MIN_CALIBRATION_WORDS usable
 * words). Callers name the exit code from err.exitCode rather than hardcoding it, matching the
 * convention of this repo's other typed engine errors (StaleBaselineError, ArgsError, BibleError).
 * The CLI turns this into exit 1 (a data-insufficiency outcome, not a usage or I/O error) with the
 * message alone on stderr.
 */
export class CorpusTooSmallError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CorpusTooSmallError';
    this.code = 'CORPUS_TOO_SMALL';
    this.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Ported measurement methodology (mulberry32, sentence splitting, weighted draw, signed
// deviation) -- see the file header for what this reuses and why.
// ---------------------------------------------------------------------------

/**
 * Seeded pseudo-random number generator (mulberry32). Deterministic: the same seed produces the
 * same sequence of draws every time, on every platform, which is what makes calibrateBaseline's
 * output byte-identical across runs for identical inputs and seed.
 *
 * @param {number} seed - integer seed
 * @returns {() => number} a function returning a new pseudo-random float in [0, 1) on each call
 */
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Strips common markdown syntax (front matter, code fences and spans, images, links, headings,
 * tables, list markers, blockquote markers, HTML tags, horizontal rules, emphasis markers, bare
 * URLs) down to plain prose, and collapses runs of whitespace, before sentence splitting. This is
 * a broader cleanup than stylometry-engine.mjs's own preprocess() (which only strips headings and
 * claim markers): calibration draws are reassembled into fresh text blocks from individually
 * selected sentences, so the sentence pool itself must already be clean prose, not raw markdown
 * fragments that would otherwise leak formatting characters into the measured text.
 *
 * @param {string} md - raw file text (markdown or plain prose)
 * @returns {string} plain prose, whitespace-collapsed and trimmed
 */
function cleanMarkdown(md) {
  return md
    .replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s.*$/gm, ' ').replace(/^\s*\|.*$/gm, ' ')
    .replace(/^\s*[-*+]\s+/gm, '').replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '').replace(/<[^>]+>/g, ' ').replace(/==+/g, ' ')
    .replace(/\*\*|__|\*|_/g, '').replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*-{3,}\s*$/gm, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

/**
 * Splits already-cleaned prose into sentences usable as resampling units: a sentence must have at
 * least 4 whitespace-delimited words, contain at least one letter, and end in one of . ! ? so that
 * a stray fragment (a lone heading remnant, a bare punctuation mark) never enters the sentence
 * pool as a "sentence" of its own.
 *
 * @param {string} text - cleaned prose (see cleanMarkdown)
 * @returns {string[]} sentence strings, in original order
 */
export function splitSentences(text) {
  return text.split(/(?<=[.!?])[\s\n]+/).map((s) => s.trim()).filter((s) => {
    const w = s.split(/\s+/).filter(Boolean).length;
    return w >= 4 && /[a-zA-Z]/.test(s) && /[.!?]$/.test(s);
  });
}

// First-person singular and plural pronoun forms mapped to their third-person-plural equivalents
// (ghostwriteTransform's pronoun leg, below).
const FIRST_PERSON_TO_THIRD_PLURAL = {
  i: 'they', me: 'them', my: 'their', mine: 'theirs', myself: 'themselves',
  we: 'they', us: 'them', our: 'their', ours: 'theirs', ourselves: 'themselves',
};

/**
 * The one drift transformation calibrateBaseline uses to synthesize a positive (ghostwritten)
 * class for the regime detectability measurement (P4): every contraction is expanded to its
 * (approximate) full form, and every first-person pronoun -- singular or plural -- becomes its
 * third-person-plural equivalent, case-preserved. This is a crude, mechanical transform, not a
 * grammar-aware rewrite: "I'm" becomes "I am" and then, in the same pass, "I" becomes "They",
 * yielding "They am" rather than "They are" -- the transform is not trying to produce fluent
 * prose, only to move the eight-marker vector the same direction a wholesale ghostwriting pass
 * reliably moves it (contraction_rate and first_person_rate collapsing toward zero).
 *
 * CAVEAT (documented verbatim per this implementation wave's design pins, and load-bearing for
 * anyone reading calibration.detectability_auc or calibration.regime): only this one drift type
 * has been measured. A wholesale rewrite by a different author, or an LLM paraphrase, is untested
 * against this statistic and may behave differently -- a consequence of ADR-0012 (voice verdict
 * scope) that the regime call does not, and cannot, resolve.
 *
 * @param {string} sentence - one sentence of same-voice prose
 * @returns {string} the sentence with contractions expanded and first-person pronouns
 *   converted to third-person plural
 */
export function ghostwriteTransform(sentence) {
  let s = sentence.replace(/\b(\w+)'(ve|re|ll|d|m|s|t)\b/gi, (_m, a, b) => {
    const expansions = { ve: ' have', re: ' are', ll: ' will', d: ' would', m: ' am', s: '', t: '' };
    return a + (expansions[b.toLowerCase()] || '');
  });
  return s.replace(/\b([A-Za-z]+)\b/g, (w) => {
    const lower = w.toLowerCase();
    if (!(lower in FIRST_PERSON_TO_THIRD_PLURAL)) return w;
    const replacement = FIRST_PERSON_TO_THIRD_PLURAL[lower];
    return w[0] === w[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
  });
}

/**
 * Draws a single resampled text block of roughly `target` words by repeatedly picking a random
 * sentence (weighted implicitly by how many draws it takes to reach target -- a longer sentence
 * contributes more words per pick) from `sentences`, optionally transforming each picked sentence,
 * until the accumulated (whitespace-word-count) total reaches target or a generous attempt guard
 * (target * 4) is hit. Sampling is WITH replacement, so a small sentence pool can still produce a
 * large-span draw; MIN_CALIBRATION_WORDS's doc comment above records why that is legitimate.
 *
 * @param {string[]} sentences - the sentence pool
 * @param {number[]} weights - whitespace word count per sentence, same length and order as sentences
 * @param {number} target - approximate word count to accumulate
 * @param {() => number} rng - a mulberry32 stream, advanced by this call
 * @param {((sentence: string) => string)|null} transform - optional per-sentence transform
 *   (ghostwriteTransform for the regime positive class; null for every other draw)
 * @returns {string} the assembled text block
 */
export function draw(sentences, weights, target, rng, transform) {
  const out = [];
  let total = 0;
  let guard = 0;
  while (total < target && guard < target * 4) {
    const i = Math.floor(rng() * sentences.length);
    out.push(transform ? transform(sentences[i]) : sentences[i]);
    total += weights[i];
    guard += 1;
  }
  return out.join(' ');
}

/**
 * Signed relative deviation, in percent, of a measured marker vector from a baseline vector, per
 * marker (P1/P2's "noise_scales values ... are the standard deviations of each marker's signed
 * relative deviation"). Unlike stylometry-engine.mjs's own computeDrift, which reports an
 * unsigned (absolute-value) percent deviation, this is deliberately SIGNED: a noise scale is the
 * spread of natural same-voice variation in both directions, not just its magnitude.
 *
 * Zero-baseline rule (matches computeDrift's, per P1): 0 if both baseline and measured are 0 for
 * that marker, else +100 (never -100 -- there is no "negative" direction to fall away from zero).
 *
 * @param {object} baselineMarkers - the eight-marker baseline vector
 * @param {object} measuredMarkers - the eight-marker vector measured on one resampled draw
 * @returns {object} per-marker signed percent deviation, keyed the same as baselineMarkers
 */
export function signedDeviation(baselineMarkers, measuredMarkers) {
  const dev = {};
  for (const marker of Object.keys(baselineMarkers)) {
    const b = baselineMarkers[marker];
    const v = measuredMarkers[marker];
    dev[marker] = (b === 0) ? (v === 0 ? 0 : 100) : (v - b) / b * 100;
  }
  return dev;
}

// ---------------------------------------------------------------------------
// Internal-only helpers (not exported: nothing outside this module needs them, and keeping the
// quantile computation internal means an external test that wants to prove the block_threshold
// really is "the 0.99 quantile of the evaluation max|z| set" has to compute that quantile with
// its own independent formula rather than importing this one -- see the calibration test file's
// header comment for the shape that guards against).
// ---------------------------------------------------------------------------

/**
 * Sample standard deviation of each marker's column across a matrix of per-draw signed-deviation
 * objects (signedDeviation's output, one per draw). A degenerate zero-variance marker (every draw
 * measured identically) is floored to a tiny positive epsilon rather than left at exactly 0, so a
 * later division by this scale can never divide by zero.
 *
 * @param {object[]} devs - array of per-marker signed-deviation objects, same keys throughout
 * @returns {object} per-marker standard deviation, keyed the same as each dev entry
 */
function computeNoiseScales(devs) {
  const markerNames = Object.keys(devs[0]);
  const scales = {};
  for (const marker of markerNames) {
    const col = devs.map((d) => d[marker]);
    const mean = col.reduce((a, v) => a + v, 0) / col.length;
    const variance = col.reduce((a, v) => a + (v - mean) ** 2, 0) / (col.length - 1);
    scales[marker] = Math.sqrt(variance) || 1e-9;
  }
  return scales;
}

/**
 * The verdict statistic (P1): the largest absolute standardized deviation across all markers,
 * for one draw's signed-deviation object scored against a set of per-marker noise scales.
 *
 * @param {object} dev - one draw's signed-deviation object (signedDeviation's output)
 * @param {object} scales - per-marker noise scales (computeNoiseScales's output)
 * @returns {number} max over markers of |dev[marker] / scales[marker]|
 */
function scoreMaxAbsZ(dev, scales) {
  let max = 0;
  for (const marker of Object.keys(dev)) {
    const z = Math.abs(dev[marker] / scales[marker]);
    if (z > max) max = z;
  }
  return max;
}

/**
 * Nearest-rank quantile over an unsorted array of numbers: sorts ascending, then picks the
 * element at index ceil(q * n) - 1, clamped into range. This is the formula block_thresholds are
 * defined against (P2: "the empirical 0.99 quantile of that rung's max|z| over a disjoint
 * same-voice evaluation set").
 *
 * @param {number[]} arr - unsorted sample values
 * @param {number} q - quantile in [0, 1]
 * @returns {number} the sample value at the requested quantile
 */
function quantile(arr, q) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Mann-Whitney AUC: the probability that a randomly chosen value from `pos` outranks a randomly
 * chosen value from `neg` (ties split evenly via average-rank handling). This is the detectability
 * statistic P4's regime rule is computed from.
 *
 * @param {number[]} pos - positive-class scores (ghostwritten draws, for the regime measurement)
 * @param {number[]} neg - negative-class scores (same-voice draws)
 * @returns {number} AUC in [0, 1]
 */
function auc(pos, neg) {
  const all = [...pos.map((v) => ({ v, p: 1 })), ...neg.map((v) => ({ v, p: 0 }))]
    .sort((a, b) => a.v - b.v);
  let rank = 1;
  let i = 0;
  let sumRanksPos = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j += 1;
    const avgRank = (rank + (rank + (j - i))) / 2;
    for (let k = i; k <= j; k += 1) if (all[k].p === 1) sumRanksPos += avgRank;
    rank += (j - i + 1);
    i = j + 1;
  }
  return (sumRanksPos - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length);
}

/**
 * Builds the resampling sentence pool and per-sentence draw weights for a set of input texts:
 * joins every text with a blank line, cleans markdown syntax down to plain prose, and splits into
 * sentences. Weight per sentence is its whitespace word count -- the same naive proxy draw() uses
 * internally to decide when a block has reached its target span (the engine's own tokenizer,
 * countWords, is only ever applied to the ASSEMBLED draw for measurement, never to this weighting).
 *
 * @param {string[]} texts - raw input texts
 * @returns {{ sentences: string[], weights: number[] }}
 */
function buildSentencePool(texts) {
  const cleaned = cleanMarkdown(texts.join('\n\n'));
  const sentences = splitSentences(cleaned);
  const weights = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  return { sentences, weights };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calibrates a five-rung noise-scale and block-threshold ladder, plus the chapter/book regime
 * call, from an author's own voice corpus. See the file header for the full methodology.
 *
 * Draw order (one mulberry32(seed) stream, advanced in this exact order, never rewound -- every
 * block below is disjoint from every other by construction):
 *   for each span in CALIBRATION_SPANS, in order [550, 1100, 2200, 4400, 8800]:
 *     1. a CALIBRATION_REPLICATES-draw calibration block at that span -> noise_scales[span]
 *     2. a CALIBRATION_REPLICATES-draw evaluation block at that span, disjoint from (1), scored
 *        against noise_scales[span] -> block_thresholds[span] (the 0.99 quantile of that block's
 *        max|z| set)
 *   then, once more, at the shortest span (CALIBRATION_SPANS[0], 550 words):
 *     3. a CALIBRATION_REPLICATES-draw ghostwritten (positive-class) block, scored against
 *        noise_scales[550] and compared via Mann-Whitney AUC against step 2's evaluation
 *        negatives at span 550 -> detectability_auc, and the regime call from REGIME_AUC_THRESHOLD
 *
 * @param {string[]} texts - raw voice-corpus texts (one or more files' contents)
 * @param {{ seed?: number }} [opts] - seed defaults to DEFAULT_SEED (4242)
 * @returns {{
 *   markers: object,
 *   calibration: {
 *     spans: number[], noise_scales: object, block_thresholds: object,
 *     detectability_auc: number, regime: 'chapter'|'book', replicates: number, seed: number,
 *   },
 * }}
 * @throws {CorpusTooSmallError} when the summed usable word count (countWords over every text)
 *   is below MIN_CALIBRATION_WORDS, OR when the corpus clears that word-count floor but yields
 *   zero sentences ending in terminal punctuation once markdown syntax is stripped (countWords
 *   and the cleanMarkdown+splitSentences pipeline that feeds draw() disagree about what counts as
 *   "usable" -- countWords tolerates markup, code fences, tables, and unpunctuated prose that
 *   splitSentences discards outright -- so a corpus can pass the first guard and still have
 *   nothing to resample from; this second, independent guard exists for exactly that gap)
 */
export function calibrateBaseline(texts, opts = {}) {
  const seed = opts.seed ?? DEFAULT_SEED;

  const totalWords = texts.reduce((sum, t) => sum + countWords(t), 0);
  if (totalWords < MIN_CALIBRATION_WORDS) {
    throw new CorpusTooSmallError(
      'voice corpus has ' + totalWords + ' usable word(s), measured by the canonical tokenizer; ' +
      'at least ' + MIN_CALIBRATION_WORDS + ' are needed to calibrate the five-rung noise-scale ' +
      'ladder (add more voice sample text, then recapture)'
    );
  }

  const markers = texts.length === 1 ? measureChapter(texts[0]) : measureBook(texts);
  const { sentences, weights } = buildSentencePool(texts);

  // Second, independent guard (review round 1): countWords (above) counts markup, code fences,
  // tables, and unpunctuated prose as words, but splitSentences requires a terminal . ! or ? and
  // discards everything else, so a corpus can clear MIN_CALIBRATION_WORDS on word count alone and
  // still produce an EMPTY sentence pool -- draw() can never crash on any pool of one or more
  // sentences (every index it picks is always in range), so zero is the exact and complete floor
  // for the failure this guards against; a larger floor would be guarding against a different,
  // not-yet-confirmed concern (degenerate-but-nonzero variance), which is out of this fix's scope.
  if (sentences.length === 0) {
    throw new CorpusTooSmallError(
      'voice corpus has ' + totalWords + ' usable word(s) but 0 sentences ending in terminal ' +
      'punctuation (a period, question mark, or exclamation point) once markdown syntax is ' +
      'stripped; calibration resamples whole punctuated sentences, so at least one is needed ' +
      '(add normal punctuated prose, then recapture)'
    );
  }

  const rng = mulberry32(seed);

  const noiseScales = {};
  const blockThresholds = {};
  let regimeSpanScales = null;
  let regimeSpanNegativeZ = null;
  const regimeSpan = CALIBRATION_SPANS[0];

  for (const span of CALIBRATION_SPANS) {
    // (1) Calibration block -> this rung's per-marker noise scale.
    const calibrationDevs = [];
    for (let r = 0; r < CALIBRATION_REPLICATES; r += 1) {
      const text = draw(sentences, weights, span, rng, null);
      calibrationDevs.push(signedDeviation(markers, measureChapter(text)));
    }
    const scales = computeNoiseScales(calibrationDevs);
    noiseScales[String(span)] = scales;

    // (2) Evaluation block, disjoint from (1) -> this rung's block_threshold.
    const evaluationZ = [];
    for (let r = 0; r < CALIBRATION_REPLICATES; r += 1) {
      const text = draw(sentences, weights, span, rng, null);
      const dev = signedDeviation(markers, measureChapter(text));
      evaluationZ.push(scoreMaxAbsZ(dev, scales));
    }
    blockThresholds[String(span)] = quantile(evaluationZ, 0.99);

    if (span === regimeSpan) {
      regimeSpanScales = scales;
      regimeSpanNegativeZ = evaluationZ;
    }
  }

  // (3) Regime detectability at the shortest rung: ghostwritten positives vs. that rung's own
  // evaluation negatives.
  const positiveZ = [];
  for (let r = 0; r < CALIBRATION_REPLICATES; r += 1) {
    const text = draw(sentences, weights, regimeSpan, rng, ghostwriteTransform);
    const dev = signedDeviation(markers, measureChapter(text));
    positiveZ.push(scoreMaxAbsZ(dev, regimeSpanScales));
  }
  const detectabilityAuc = auc(positiveZ, regimeSpanNegativeZ);
  const regime = detectabilityAuc >= REGIME_AUC_THRESHOLD ? 'chapter' : 'book';

  return {
    markers,
    calibration: {
      spans: CALIBRATION_SPANS,
      noise_scales: noiseScales,
      block_thresholds: blockThresholds,
      detectability_auc: detectabilityAuc,
      regime,
      replicates: CALIBRATION_REPLICATES,
      seed,
    },
  };
}
