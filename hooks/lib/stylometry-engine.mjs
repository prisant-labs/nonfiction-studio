// what-it-is:   deterministic eight-marker voice-drift engine
// what-it-does: measures the eight-marker stylometry vector for one chapter or an aggregate
//               book, then computes a drift VERDICT against a stored baseline: the largest
//               standardized deviation (max |z|) across the eight markers, each marker's
//               deviation standardized against a per-span noise scale read from the baseline's
//               own calibration ladder (ADR-0012, voice verdict scope, Decision 1 and Decision
//               3), rather than an unweighted sum of capped deviations. The ladder is looked up
//               by log-linear interpolation (linear in ln of the scored word count) between the
//               calibration rungs the author's own voice corpus was measured at, clamped to the
//               end rung's value beyond either end. type_token_ratio is a moving average over a
//               fixed TTR_WINDOW_SIZE-token window, which makes it length-invariant; scoring
//               against a baseline captured under a different marker_set_version, or one missing
//               a complete calibration ladder, fails rather than silently misreading the numbers.
// why:          the engine logic lives in a lib module so both bin/ns-stylometry (CLI) and the
//               Stop gate hook share the same computation path per S-07 section 4
// used-by:      bin/ns-stylometry, hooks/stop-gate.mjs

// ---------------------------------------------------------------------------
// Closed-class function word set (deterministic; changing this set changes the
// function_word_rate marker value, which triggers reconciliation per TSK-026 (ns-stylometry engine)).
// Set size: 128 entries covering articles, prepositions, conjunctions, pronouns,
// auxiliaries, modals, negation, and high-frequency adverbs.
// ---------------------------------------------------------------------------
const FUNCTION_WORDS = new Set([
  // articles
  'a', 'an', 'the',
  // coordinating conjunctions
  'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  // subordinating conjunctions
  'after', 'although', 'as', 'because', 'before', 'even', 'how', 'if',
  'once', 'since', 'than', 'that', 'though', 'till', 'unless', 'until',
  'when', 'whenever', 'where', 'wherever', 'whether', 'while',
  // prepositions
  'about', 'above', 'across', 'against', 'along', 'among', 'around',
  'at', 'behind', 'below', 'beneath', 'beside', 'besides', 'between',
  'beyond', 'by', 'despite', 'down', 'during', 'except', 'from', 'in',
  'inside', 'into', 'like', 'near', 'of', 'off', 'on', 'onto', 'out',
  'outside', 'over', 'past', 'through', 'throughout', 'to', 'toward',
  'towards', 'under', 'unto', 'up', 'upon', 'via', 'with', 'within',
  'without',
  // personal pronouns
  'i', 'me', 'my', 'mine', 'myself',
  'we', 'us', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'they', 'them', 'their', 'theirs', 'themselves',
  // relative / interrogative pronouns
  'who', 'whom', 'whose', 'what', 'which',
  // demonstrative pronouns
  'this', 'that', 'these', 'those',
  // indefinite pronouns and determiners
  'all', 'another', 'any', 'both', 'each', 'either', 'enough',
  'every', 'few', 'many', 'more', 'most', 'much', 'neither', 'none',
  'one', 'other', 'same', 'several', 'some',
  // auxiliary verbs
  'am', 'are', 'be', 'been', 'being', 'did', 'do', 'does', 'doing',
  'done', 'had', 'has', 'have', 'having', 'is', 'was', 'were',
  // modals
  'can', 'could', 'may', 'might', 'must', 'ought', 'shall', 'should',
  'will', 'would',
  // negation
  'no', 'not',
  // common adverbs
  'again', 'already', 'also', 'always', 'else', 'even', 'ever',
  'here', 'however', 'instead', 'just', 'never', 'now', 'often',
  'only', 'quite', 'rather', 'really', 'still', 'then', 'there',
  'therefore', 'thus', 'too', 'usually', 'very', 'when', 'where',
  'why', 'yet',
]);

// First-person pronouns (singular and plural) used for first_person_rate.
const FIRST_PERSON = new Set(['i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours', 'ourselves']);

// Second-person pronouns used for second_person_rate.
const SECOND_PERSON = new Set(['you', 'your', 'yours', 'yourself', 'yourselves']);

// Word regex: Unicode letter sequences, hyphenated compounds as a single token.
// Matches "well-curated" as one token, "listening-to-speaking" as one token.
// \p{L} (marker_set_version 4) matches any Unicode letter, not just a-z/A-Z, so a
// precomposed (NFC) accented word like "cafe" with an acute or a Cyrillic or Greek
// word tokenizes as one whole word instead of fragmenting at the accented letter.
// Two residual limits, both deliberate and both left alone rather than guessed at:
// a script written without spaces between words (CJK, Thai, Khmer) has no word
// boundary for this regex to find, so a whole run of such letters matches as ONE
// token, not one token per intended word; and NFD-decomposed text (a base letter
// followed by a separate combining mark, U+0301 and similar, category \p{M} not
// \p{L}) still fragments at the combining mark, the same way the old regex
// fragmented every accented letter, because \p{L}+ does not include \p{M}.
const WORD_RE = /\p{L}+(?:-\p{L}+)*/gu;

// Contraction regex: apostrophe-bonded tokens (captures both contractions like
// "don't" and possessives like "community's"). The character class is ASCII-only by
// design: preprocess() folds typographic apostrophes to U+0027 before this runs, so
// this regex never has to know about them. Do not widen it here without removing
// the fold, or the two mechanisms will drift apart.
const CONTRACTION_RE = /[a-zA-Z]+'[a-zA-Z]+/g;

// Punctuation regex: common prose punctuation characters counted per 100 words.
// Hyphens within hyphenated words are NOT counted (they are part of the word token).
// Hyphens standing alone between spaces (used as dashes) are counted.
// ASCII-only by design, for the same reason as CONTRACTION_RE: preprocess() folds
// typographic double quotes to U+0022 before this runs.
const PUNCT_RE = /[.,;:!?()"]/g;

// Sentence-end detection: one or more .!? followed by whitespace or end of string.
// Applied after text normalization (all whitespace collapsed to single space).
const SENTENCE_END_RE = /[.!?]+(?:\s|$)/g;

// Moving-average type-token ratio window size, in tokens (Correction A, roadmap row 1.7,
// voice registers). A single named constant, not a literal scattered through the code.
// Fixed for this task; not read from .studio/config.json (deferred scope). Text shorter
// than or equal to one window falls back to the plain ratio over the whole text -- see
// movingAverageTypeTokenRatio.
const TTR_WINDOW_SIZE = 100;

// Current stylometry marker-set version. Bumped whenever a marker's computation changes
// meaning under the same key name. A baseline captured under an earlier version would be
// silently misread as enormous drift if scored without the guard in computeDrift; a
// stylometry.baseline object predating this field entirely is treated as version 1.
// Exported so tests and callers can reference it by name instead of hardcoding the number.
//
// History:
//   1 -> 2  type_token_ratio moved from a flat ratio to a TTR_WINDOW_SIZE-token moving
//           average, which changed the same key's value on the same prose.
//   2 -> 3  preprocess() folds typographic quotation characters to their ASCII
//           equivalents. Before this, contraction_rate read 0 for any text written with
//           the smart apostrophe every mainstream word processor emits by default, and
//           punctuation_rate omitted every smart double quote. Nothing in this repository
//           uses those characters, so no baseline value stored here moves; the bump is
//           for baselines captured OUTSIDE it, where a pre-fix capture of the same prose
//           carries a different contraction_rate than a post-fix capture would.
//   3 -> 4  WORD_RE moved from an ASCII-only [a-zA-Z] character class to \p{L}, the
//           Unicode letter category. Before this, an accented letter split a word in
//           two ("cafe" with an acute became "caf" plus a lost fragment), which changed
//           totalWords and therefore SEVEN of the eight markers for any chapter mentioning
//           an accented name or borrowed word. Only contraction_rate is unaffected, because
//           its denominator is sentences rather than words. The other seven all move:
//           function_word_rate, first_person_rate, second_person_rate, type_token_ratio,
//           and avg_word_length share the word denominator directly; avg_sentence_length is
//           words per sentence; and punctuation_rate is punctuation per hundred words. An
//           earlier version of this comment listed five and read as exhaustive. Nothing in this repository
//           uses a non-ASCII letter, so no baseline value stored here moves; the bump is
//           for baselines captured OUTSIDE it, where a pre-fix capture of accented prose
//           carries different word-denominated markers than a post-fix capture would.
//   4 -> 5  computeDrift's combining rule changed from an unweighted, per-marker-capped sum
//           to the largest standardized deviation (max |z|) against a stored per-span
//           calibration ladder (ADR-0012, voice verdict scope, Decision 1 and Decision 3).
//           The capped sum was measured, on this implementation wave's own labeled probe, to
//           discriminate a genuine planted ghostwriting signature from ordinary chapter-to-
//           chapter voice variation at AUC 0.53 on real prose at chapter scale -- a coin
//           flip. Summing every marker's (bounded) deviation dilutes whatever signal one or
//           two markers actually carry across six that usually do not; taking the max instead
//           concentrates the verdict on wherever the real signal lives. The eight markers
//           keyed under baseline.markers are UNCHANGED by this bump -- no marker's own
//           computation moved, unlike every earlier entry in this History. What changed is
//           how a measured vector is judged: a v5 baseline carries a calibration sibling
//           (per-span noise_scales and block_thresholds, measured from the author's own
//           voice corpus by nfs-capture-voice) that a v4 baseline does not have, so scoring
//           against a v4 baseline is rejected as stale rather than silently read as z scores
//           computed against no calibration at all. The remedy is unchanged: re-run
//           nfs-capture-voice to recapture the baseline under the corrected engine.
export const CURRENT_MARKER_SET_VERSION = 5;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strips markdown headings and all four claim-marker forms from chapter text.
 * Heading lines (starting with #) and the [claim: EV-NNNN], [quote: EV-NNNN],
 * [UNVERIFIED], and [SOURCE-UNVERIFIABLE] tags (docs/formats/claim-markers.md)
 * are removed. All other whitespace is preserved until normalization.
 *
 * @param {string} text - raw chapter file content
 * @returns {string} prose with headings and all four marker forms removed
 */
function preprocess(text) {
  let t = text.replace(/^#{1,6}\s.*$/gm, '');
  t = t.replace(/\[claim:\s*EV-\d{4}\]/g, '');
  t = t.replace(/\[quote:\s*EV-\d{4}\]/g, '');
  t = t.replace(/\[UNVERIFIED\]/g, '');
  t = t.replace(/\[SOURCE-UNVERIFIABLE\]/g, '');
  t = foldTypographicQuotes(t);
  return t;
}

/**
 * Folds typographic quotation characters to their ASCII equivalents, so that
 * CONTRACTION_RE and PUNCT_RE, both deliberately ASCII-only, see prose written in
 * a word processor the same way they see prose written in a plain-text editor.
 *
 * Why this exists: Word, Google Docs, Obsidian, and most modern editors emit
 * U+2019 for an apostrophe by default. CONTRACTION_RE matched only U+0027, so an
 * author who pasted writing samples from any of them captured a baseline with
 * contraction_rate = 0, and every chapter they later wrote with a plain apostrophe
 * then read as a 100 percent deviation on that marker. The same applied, less
 * severely, to PUNCT_RE and the smart double quotes U+201C and U+201D.
 *
 * Deliberately NOT folded: U+2026 (horizontal ellipsis). Expanding it to three
 * periods would count as three punctuation characters instead of one and could
 * introduce a spurious sentence boundary mid-sentence, since SENTENCE_END_RE
 * treats a run of periods followed by whitespace as a sentence end. Its correct
 * treatment is a separate question from this fold and is left alone rather than
 * guessed at.
 *
 * A folded single quote cannot become a false contraction: CONTRACTION_RE requires
 * a letter on BOTH sides of the apostrophe, and a quotation mark has whitespace or
 * punctuation on one side by construction.
 *
 * @param {string} t - text after marker stripping
 * @returns {string} the same text with smart quotes folded to ASCII
 */
function foldTypographicQuotes(t) {
  return t
    .replace(/[\u2018\u2019\u201A\u201B\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');
}

/**
 * Extracts raw integer counts from preprocessed prose text.
 * These counts are aggregated across chapters in measureBook before ratios
 * are derived, ensuring book-level ratios are computed from combined counts
 * rather than averaged from per-chapter ratios.
 *
 * @param {string} rawText - original chapter text (preprocessing applied inside)
 * @returns {object} raw count object used by measureChapter and measureBook
 */
function extractCounts(rawText) {
  const text = preprocess(rawText);

  // Normalize whitespace so sentence-end detection works uniformly.
  const normalized = text.replace(/\s+/g, ' ').trim();

  // Word tokens: alpha sequences with optional hyphen-joined parts.
  WORD_RE.lastIndex = 0;
  const wordTokens = normalized.match(WORD_RE) || [];
  const totalWords = wordTokens.length;
  const lowerWords = wordTokens.map(w => w.toLowerCase());

  // Function word count (case-insensitive via lower-cased tokens).
  let functionWordCount = 0;
  for (const w of lowerWords) {
    if (FUNCTION_WORDS.has(w)) functionWordCount++;
  }

  // Contraction/possessive count (apostrophe-bonded tokens; scanned on normalized text).
  CONTRACTION_RE.lastIndex = 0;
  const contractionTokens = normalized.match(CONTRACTION_RE) || [];
  const contractionCount = contractionTokens.length;

  // First-person pronoun count.
  let firstPersonCount = 0;
  for (const w of lowerWords) {
    if (FIRST_PERSON.has(w)) firstPersonCount++;
  }

  // Second-person pronoun count.
  let secondPersonCount = 0;
  for (const w of lowerWords) {
    if (SECOND_PERSON.has(w)) secondPersonCount++;
  }

  // Total character length across all word tokens (for avg_word_length).
  let totalCharLength = 0;
  for (const w of wordTokens) totalCharLength += w.length;

  // Punctuation count (applied to normalized prose, after marker stripping).
  PUNCT_RE.lastIndex = 0;
  const punctTokens = normalized.match(PUNCT_RE) || [];
  const punctCount = punctTokens.length;

  // Sentence count: count sentence-ending punctuation sequences.
  SENTENCE_END_RE.lastIndex = 0;
  const sentenceEnds = normalized.match(SENTENCE_END_RE) || [];
  // A non-empty text that produced no sentence-ending punctuation is treated as
  // one implied sentence (for example, a short label or fragment).
  const sentenceCount = sentenceEnds.length > 0
    ? sentenceEnds.length
    : (normalized.length > 0 ? 1 : 0);

  // All lower-cased word tokens kept for TTR aggregation in measureBook.
  return {
    totalWords,
    functionWordCount,
    contractionCount,
    firstPersonCount,
    secondPersonCount,
    totalCharLength,
    punctCount,
    sentenceCount,
    // lowerWords carried for book-level unique-word accumulation.
    lowerWords,
  };
}

/**
 * Computes the moving-average type-token ratio: the mean of the plain unique/total
 * ratio over every sliding window of TTR_WINDOW_SIZE tokens (Correction A, roadmap
 * row 1.7, voice registers). Length-invariant by construction, because the window
 * never changes size no matter how much text is measured -- unlike a flat ratio,
 * whose denominator grows with the text while vocabulary growth slows, so it keeps
 * falling on longer samples for reasons that have nothing to do with a change in
 * voice. Residual note: this reduces the length artifact structurally, it does not
 * abolish it; a very short window-count still carries some sample-size noise.
 *
 * Text shorter than or equal to one window falls back to the plain ratio over the
 * whole text -- a single window spanning everything reduces to the same arithmetic.
 *
 * Implementation: an incremental sliding window (a frequency map updated one token
 * at a time) rather than rescanning each window from scratch, so a book-length
 * corpus costs O(totalWords), not O(totalWords * TTR_WINDOW_SIZE).
 *
 * @param {string[]} lowerWords - lower-cased word tokens in original order
 * @returns {number} moving-average type-token ratio; 0 for an empty token list
 */
function movingAverageTypeTokenRatio(lowerWords) {
  const n = lowerWords.length;
  if (n === 0) return 0;
  if (n <= TTR_WINDOW_SIZE) {
    return new Set(lowerWords).size / n;
  }

  const freq = new Map();
  let uniqueCount = 0;
  for (let i = 0; i < TTR_WINDOW_SIZE; i++) {
    const w = lowerWords[i];
    const c = (freq.get(w) || 0) + 1;
    freq.set(w, c);
    if (c === 1) uniqueCount++;
  }

  const windowCount = n - TTR_WINDOW_SIZE + 1;
  let sumRatios = uniqueCount / TTR_WINDOW_SIZE;

  for (let start = 1; start < windowCount; start++) {
    const outgoing = lowerWords[start - 1];
    const outgoingCount = freq.get(outgoing) - 1;
    freq.set(outgoing, outgoingCount);
    if (outgoingCount === 0) uniqueCount--;

    const incoming = lowerWords[start + TTR_WINDOW_SIZE - 1];
    const incomingCount = (freq.get(incoming) || 0) + 1;
    freq.set(incoming, incomingCount);
    if (incomingCount === 1) uniqueCount++;

    sumRatios += uniqueCount / TTR_WINDOW_SIZE;
  }

  return sumRatios / windowCount;
}

/**
 * Derives the eight-marker vector from aggregated raw counts.
 * All ratios are computed from the aggregated numerators and denominators
 * rather than averaged from per-chapter values.
 *
 * Returned object key names match the baseline.markers keys in config.json
 * exactly, as required by the reconciliation protocol. type_token_ratio is
 * the moving-average ratio (movingAverageTypeTokenRatio); the key name is
 * unchanged from the flat-ratio predecessor it replaces -- a windowed moving
 * average is still a type-token ratio.
 *
 * @param {object} counts - aggregated raw count object (same shape as extractCounts output
 *   except lowerWords may be a merged array from multiple chapters)
 * @returns {object} eight-marker vector
 */
function ratiosFromCounts(counts) {
  const { totalWords, functionWordCount, contractionCount, firstPersonCount,
          secondPersonCount, totalCharLength, punctCount, sentenceCount, lowerWords } = counts;

  return {
    function_word_rate:   totalWords  > 0 ? functionWordCount / totalWords        : 0,
    contraction_rate:     sentenceCount > 0 ? contractionCount / sentenceCount     : 0,
    first_person_rate:    totalWords  > 0 ? firstPersonCount  / totalWords * 100  : 0,
    second_person_rate:   totalWords  > 0 ? secondPersonCount / totalWords * 100  : 0,
    type_token_ratio:     movingAverageTypeTokenRatio(lowerWords),
    avg_word_length:      totalWords  > 0 ? totalCharLength   / totalWords        : 0,
    avg_sentence_length:  sentenceCount > 0 ? totalWords      / sentenceCount     : 0,
    punctuation_rate:     totalWords  > 0 ? punctCount        / totalWords * 100  : 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Measures the eight-marker stylometry vector for a single chapter.
 *
 * Preprocessing: markdown headings (lines beginning with #) and all four
 * claim-marker forms ([claim: EV-NNNN], [quote: EV-NNNN], [UNVERIFIED], and
 * [SOURCE-UNVERIFIABLE]) are stripped before any measurement.
 *
 * @param {string} text - full chapter file content
 * @returns {object} eight-marker vector with keys matching config.json
 *   stylometry.baseline.markers
 */
export function measureChapter(text) {
  const counts = extractCounts(text);
  return ratiosFromCounts(counts);
}

/**
 * Measures the aggregate eight-marker vector for a whole book by combining
 * raw counts from every chapter before deriving ratios.
 *
 * type_token_ratio is the moving-average ratio (movingAverageTypeTokenRatio)
 * over the concatenated token stream of all chapters, in the order given.
 * Unlike the other seven markers, which are aggregate sums or ratios and so
 * are order-independent, type_token_ratio's value can shift slightly with
 * chapter order, because a window can span a chapter boundary. Both real
 * callers (bin/ns-stylometry, hooks/lib/gate-engine.mjs) sort chapter files
 * by name before calling measureBook, so this is deterministic in practice.
 *
 * @param {string[]} chapters - array of raw chapter text strings, in the
 *   order they are concatenated for type_token_ratio's sliding window
 * @returns {object} eight-marker aggregate vector
 */
export function measureBook(chapters) {
  let totalWords        = 0;
  let functionWordCount = 0;
  let contractionCount  = 0;
  let firstPersonCount  = 0;
  let secondPersonCount = 0;
  let totalCharLength   = 0;
  let punctCount        = 0;
  let sentenceCount     = 0;
  const allLowerWords   = [];

  for (const text of chapters) {
    const c = extractCounts(text);
    totalWords        += c.totalWords;
    functionWordCount += c.functionWordCount;
    contractionCount  += c.contractionCount;
    firstPersonCount  += c.firstPersonCount;
    secondPersonCount += c.secondPersonCount;
    totalCharLength   += c.totalCharLength;
    punctCount        += c.punctCount;
    sentenceCount     += c.sentenceCount;
    for (const w of c.lowerWords) allLowerWords.push(w);
  }

  return ratiosFromCounts({
    totalWords, functionWordCount, contractionCount, firstPersonCount,
    secondPersonCount, totalCharLength, punctCount, sentenceCount,
    lowerWords: allLowerWords,
  });
}

/**
 * Returns the word count for a chapter text using the canonical tokenizer.
 * This is the SINGLE word-counting authority for the doctor-engine word-count
 * coherence check (TSK-028 banked adjudication 2).
 * Preprocessing: headings and all four claim-marker forms ([claim: EV-NNNN],
 * [quote: EV-NNNN], [UNVERIFIED], and [SOURCE-UNVERIFIABLE]) are stripped
 * first, matching the tokenization path used by measureChapter.
 *
 * @param {string} rawText - full chapter file content
 * @returns {number} integer word count
 */
export function countWords(rawText) {
  return extractCounts(rawText).totalWords;
}

/**
 * Typed error for a stylometry baseline captured under a stale marker_set_version.
 * Callers catch StaleBaselineError (or check err.name) and treat it like any other
 * operational error (hooks/lib/gate-engine.mjs's existing per-check try/catch already
 * turns this into a skip verdict and exit code 2 with no changes needed there). The
 * remedy is always the same: re-run nfs-capture-voice to recapture the baseline with the
 * corrected engine.
 */
export class StaleBaselineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StaleBaselineError';
    this.code = 'STALE_BASELINE';
    this.exitCode = 2;
  }
}

/**
 * Typed error for a stylometry baseline whose marker_set_version matches the engine but whose
 * calibration object is missing, incomplete, or missing a rung's noise scale for one of the
 * markers baseline.markers carries. computeDrift's verdict is read directly from a stored
 * calibration ladder (never an assumed constant, per ADR-0012 voice verdict scope), so a
 * baseline that carries markers but no usable ladder cannot be scored at all -- silently
 * falling back to an epsilon noise scale would manufacture a z score against a null nobody
 * measured. Callers catch InvalidCalibrationError (or check err.name) the same way they catch
 * StaleBaselineError; the remedy is the same: re-run nfs-capture-voice, which is the only path
 * that writes a calibration ladder into stylometry.baseline.calibration.
 */
export class InvalidCalibrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidCalibrationError';
    this.code = 'INVALID_CALIBRATION';
    this.exitCode = 2;
  }
}

/**
 * Looks up a per-span ladder value at a given scored-word count W, by log-linear interpolation
 * (linear in ln W) between the two bracketing rungs, clamped to the nearest end rung's value
 * when W falls beyond either end of the ladder (P1/P3: never extrapolate the sqrt law beyond
 * the rungs -- a clamped scale beyond the top rung is deliberately larger than the true noise,
 * which deflates z and softens detection, the affordable error mode at book scale; extrapolating
 * measured as under-predicting the null instead, which means excess false blocks).
 *
 * Internal only: not exported. A scoring-time concern of this module, not the calibration
 * module's -- calibrateBaseline (hooks/lib/stylometry-calibration.mjs) only ever measures AT
 * the exact rung spans; interpolating and clamping between them belongs to the code that reads
 * the ladder back, at whatever scoredWords a caller happens to be scoring.
 *
 * @param {number[]} spans - calibration.spans, ascending
 * @param {(span: number) => number} valueAt - the rung value at one exact span
 * @param {number} W - scored word count to look up
 * @returns {number} the interpolated (or clamped) value at W
 */
function ladderLookup(spans, valueAt, W) {
  const last = spans.length - 1;
  if (W <= spans[0]) return valueAt(spans[0]);
  if (W >= spans[last]) return valueAt(spans[last]);
  for (let i = 0; i < last; i += 1) {
    const lo = spans[i];
    const hi = spans[i + 1];
    if (W >= lo && W <= hi) {
      const t = (Math.log(W) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
      const vLo = valueAt(lo);
      const vHi = valueAt(hi);
      return vLo + t * (vHi - vLo);
    }
  }
  // Unreachable when spans is ascending and W is a finite number, since the two clamps above
  // already cover W outside [spans[0], spans[last]].
  return valueAt(spans[last]);
}

/**
 * Computes the drift verdict and per-marker analysis by comparing a measured vector against
 * the stored baseline's calibration ladder.
 *
 * Verdict formula (P1, ADR-0012 voice verdict scope, Decision 1 and Decision 3):
 *   relDev_m   = signed relative deviation in percent, (measured - baseline) / baseline * 100;
 *                zero-baseline rule unchanged from the prior formula: 0 if both baseline and
 *                measured are 0 for that marker, else +100 (never -100 -- there is no
 *                "negative" direction to fall away from zero)
 *   scale_m(W) = ladderLookup of marker m's noise scale (baseline.calibration.noise_scales)
 *                at scoredWords W
 *   z_m        = relDev_m / scale_m(W)                                  (SIGNED)
 *   statistic  = max over markers of |z_m|                              (the verdict number)
 *   threshold  = ladderLookup of baseline.calibration.block_thresholds at scoredWords W
 *   exceeded   = statistic >= threshold
 * deviationPct keeps the prior absolute-value semantics (Math.abs(relDev_m)) for the honest,
 * uncapped per-marker deviation an explain view names; z is signed, so a caller can say whether
 * a marker moved above or below its baseline, not just by how much.
 *
 * A marker is flagged when its deviationPct exceeds the per-marker tolerance band
 * (thresholds.stylometry_marker_tolerance, default 2.0) -- this advisory band is unrelated to
 * the calibrated verdict and is kept unchanged (P7: stylometry_marker_tolerance is NOT retired).
 *
 * worstMarker is the marker attaining max |z_m|; a tie is broken by Object.keys(markers) order
 * (the first marker reaching the running maximum keeps it, since the loop below only replaces
 * on a STRICT greater-than).
 *
 * Validation order (each guard below short-circuits the next):
 *   1. baseline.markers missing                                  -> plain Error
 *   2. baseline.marker_set_version !== CURRENT_MARKER_SET_VERSION -> StaleBaselineError
 *      (a baseline missing the field entirely is treated as version 1)
 *   3. baseline.calibration missing, or missing spans/noise_scales/block_thresholds/regime,
 *      or a rung missing a noise scale or threshold, or a rung's noise_scales missing a marker
 *      that baseline.markers carries                             -> InvalidCalibrationError
 *      (checked for every rung up front, not just the rung(s) a particular W would look up, so
 *      an incomplete ladder fails the same way regardless of scoredWords)
 *   4. opts.scoredWords missing or not a positive number          -> plain Error
 *
 * @param {object} measured   - marker vector from measureBook or measureChapter
 * @param {object} baseline   - the stored stylometry.baseline object from config.json, shaped
 *   { markers: {...8 markers}, marker_set_version, calibration: {...P2 shape...} }. This is NOT
 *   just the markers sub-object: marker_set_version and calibration live alongside markers, not
 *   inside it, and computeDrift needs all three to score safely.
 * @param {object} thresholds - thresholds block from config.json (only
 *   stylometry_marker_tolerance and drift_score_max are read; the latter only to decide whether
 *   to emit its retirement notice, never to score)
 * @param {{ scoredWords: number }} opts - scoredWords is the word count (countWords/measureBook's
 *   totalWords) the calibration ladder is looked up at; required, must be a positive number
 * @returns {{
 *   statistic: number, worstMarker: string, threshold: number, exceeded: boolean,
 *   regime: 'chapter'|'book', perMarker: object[], markerTolerance: number,
 *   deprecations: string[],
 * }}
 *   perMarker entries carry { marker, baseline, measured, deviationPct, z, flagged }.
 * @throws {Error} when baseline.markers is missing, or opts.scoredWords is missing or
 *   non-positive
 * @throws {StaleBaselineError} when baseline.marker_set_version does not match
 *   CURRENT_MARKER_SET_VERSION
 * @throws {InvalidCalibrationError} when baseline.calibration is missing or incomplete
 */
export function computeDrift(measured, baseline, thresholds, opts) {
  if (!baseline || !baseline.markers) {
    throw new Error(
      'computeDrift: baseline.markers is missing; expected the stylometry.baseline object ' +
      '(with a markers sub-object), not just the markers object by itself'
    );
  }
  const markers = baseline.markers;
  const storedVersion = (baseline.marker_set_version != null) ? baseline.marker_set_version : 1;

  if (storedVersion !== CURRENT_MARKER_SET_VERSION) {
    throw new StaleBaselineError(
      'stylometry baseline marker_set_version ' + storedVersion + ' does not match the ' +
      'engine\'s current marker set version ' + CURRENT_MARKER_SET_VERSION + '; run ' +
      'nfs-capture-voice to re-capture the baseline with the corrected engine'
    );
  }

  const calibration = baseline.calibration;
  if (
    !calibration ||
    !Array.isArray(calibration.spans) || calibration.spans.length === 0 ||
    !calibration.noise_scales || !calibration.block_thresholds || !calibration.regime
  ) {
    throw new InvalidCalibrationError(
      'stylometry baseline marker_set_version ' + storedVersion + ' is missing a complete ' +
      'calibration ladder (spans, noise_scales, block_thresholds, and regime are all ' +
      'required); run nfs-capture-voice to re-capture the baseline with a full calibration ladder'
    );
  }
  const spans = calibration.spans;
  for (const span of spans) {
    const rung = calibration.noise_scales[String(span)];
    if (!rung) {
      throw new InvalidCalibrationError(
        'stylometry baseline calibration is missing noise_scales for span ' + span + '; run ' +
        'nfs-capture-voice to re-capture the baseline with a full calibration ladder'
      );
    }
    for (const marker of Object.keys(markers)) {
      if (!(marker in rung)) {
        throw new InvalidCalibrationError(
          'stylometry baseline calibration is missing a noise scale for marker "' + marker +
          '" at span ' + span + '; run nfs-capture-voice to re-capture the baseline with a ' +
          'full calibration ladder'
        );
      }
    }
    if (!(String(span) in calibration.block_thresholds)) {
      throw new InvalidCalibrationError(
        'stylometry baseline calibration is missing a block_threshold for span ' + span +
        '; run nfs-capture-voice to re-capture the baseline with a full calibration ladder'
      );
    }
  }

  if (!opts || opts.scoredWords == null || !(opts.scoredWords > 0)) {
    throw new Error(
      'computeDrift: opts.scoredWords is required and must be a positive number (the scored ' +
      'word count used to look up the calibration ladder)'
    );
  }
  const W = opts.scoredWords;

  const markerTolerance = (thresholds && thresholds.stylometry_marker_tolerance != null)
    ? thresholds.stylometry_marker_tolerance
    : 2.0;

  const deprecations = [];
  if (thresholds && thresholds.drift_score_max != null) {
    deprecations.push(
      'thresholds.drift_score_max is retired by the calibrated-null verdict and is ignored; ' +
      'remove it from config.json (it will be an error in a future release)'
    );
  }

  const perMarker = [];
  let statistic = 0;
  let worstMarker = Object.keys(markers)[0];

  for (const marker of Object.keys(markers)) {
    const baselineVal = markers[marker];
    const measuredVal = (measured != null && marker in measured) ? measured[marker] : 0;

    let relDev;
    if (baselineVal === 0) {
      relDev = measuredVal === 0 ? 0 : 100;
    } else {
      relDev = (measuredVal - baselineVal) / baselineVal * 100;
    }
    const deviationPct = Math.abs(relDev);

    const scale = ladderLookup(spans, (span) => calibration.noise_scales[String(span)][marker], W);
    const z = relDev / scale;
    const flagged = deviationPct > markerTolerance;

    perMarker.push({
      marker,
      baseline: baselineVal,
      measured: measuredVal,
      deviationPct,
      z,
      flagged,
    });

    if (Math.abs(z) > statistic) {
      statistic = Math.abs(z);
      worstMarker = marker;
    }
  }

  const threshold = ladderLookup(spans, (span) => calibration.block_thresholds[String(span)], W);
  const exceeded = statistic >= threshold;

  return {
    statistic,
    worstMarker,
    threshold,
    exceeded,
    regime: calibration.regime,
    perMarker,
    markerTolerance,
    deprecations,
  };
}
