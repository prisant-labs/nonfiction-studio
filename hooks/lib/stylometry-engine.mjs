// what-it-is:   deterministic eight-marker voice-drift engine
// what-it-does: measures the eight-marker stylometry vector for one chapter or an aggregate
//               book, then computes a drift score against a stored baseline using the sum-of-
//               per-marker-deviationPct formula documented in TSK-022 report
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

// Word regex: alpha sequences, hyphenated compounds as a single token.
// Matches "well-curated" as one token, "listening-to-speaking" as one token.
const WORD_RE = /[a-zA-Z]+(?:-[a-zA-Z]+)*/g;

// Contraction regex: apostrophe-bonded tokens (captures both contractions like
// "don't" and possessives like "community's").
const CONTRACTION_RE = /[a-zA-Z]+'[a-zA-Z]+/g;

// Punctuation regex: common prose punctuation characters counted per 100 words.
// Hyphens within hyphenated words are NOT counted (they are part of the word token).
// Hyphens standing alone between spaces (used as dashes) are counted.
const PUNCT_RE = /[.,;:!?()"]/g;

// Sentence-end detection: one or more .!? followed by whitespace or end of string.
// Applied after text normalization (all whitespace collapsed to single space).
const SENTENCE_END_RE = /[.!?]+(?:\s|$)/g;

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
  return t;
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
 * Derives the eight-marker vector from aggregated raw counts.
 * All ratios are computed from the aggregated numerators and denominators
 * rather than averaged from per-chapter values.
 *
 * Returned object key names match the baseline.markers keys in config.json
 * exactly, as required by the reconciliation protocol.
 *
 * @param {object} counts - aggregated raw count object (same shape as extractCounts output
 *   except lowerWords may be a merged array from multiple chapters)
 * @returns {object} eight-marker vector
 */
function ratiosFromCounts(counts) {
  const { totalWords, functionWordCount, contractionCount, firstPersonCount,
          secondPersonCount, totalCharLength, punctCount, sentenceCount, lowerWords } = counts;

  const uniqueWordCount = new Set(lowerWords).size;

  return {
    function_word_rate:   totalWords  > 0 ? functionWordCount / totalWords        : 0,
    contraction_rate:     sentenceCount > 0 ? contractionCount / sentenceCount     : 0,
    first_person_rate:    totalWords  > 0 ? firstPersonCount  / totalWords * 100  : 0,
    second_person_rate:   totalWords  > 0 ? secondPersonCount / totalWords * 100  : 0,
    type_token_ratio:     totalWords  > 0 ? uniqueWordCount   / totalWords        : 0,
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
 * type_token_ratio uses the union of unique words across all chapters, not
 * the mean of per-chapter TTRs, matching the documented TSK-019 method.
 *
 * @param {string[]} chapters - array of raw chapter text strings; order does
 *   not affect any marker value
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
 * Computes the drift score and per-marker analysis by comparing a measured
 * vector against the stored baseline.
 *
 * Drift formula (TSK-022 report, which overrides the brief sketch):
 *   deviationPct = |measured - baseline| / baseline * 100
 *   score = SUM of deviationPct across all markers in the baseline
 *
 * Zero-baseline rule per brief:
 *   when baseline === 0: deviationPct = 0 if measured === 0, else 100
 *
 * A marker is flagged when its deviationPct exceeds the per-marker tolerance
 * band (thresholds.stylometry_marker_tolerance, default 2.0).
 *
 * @param {object} measured   - marker vector from measureBook or measureChapter
 * @param {object} baseline   - stored markers object from config.json
 *   stylometry.baseline.markers
 * @param {object} thresholds - thresholds block from config.json
 * @returns {{ score: number, perMarker: object[], exceeded: boolean }}
 */
export function computeDrift(measured, baseline, thresholds) {
  const markerTolerance = (thresholds && thresholds.stylometry_marker_tolerance != null)
    ? thresholds.stylometry_marker_tolerance
    : 2.0;
  const driftScoreMax = (thresholds && thresholds.drift_score_max != null)
    ? thresholds.drift_score_max
    : 35;

  const perMarker = [];
  let score = 0;

  for (const marker of Object.keys(baseline)) {
    const baselineVal = baseline[marker];
    const measuredVal = (measured != null && marker in measured) ? measured[marker] : 0;

    let deviationPct;
    if (baselineVal === 0) {
      deviationPct = measuredVal === 0 ? 0 : 100;
    } else {
      deviationPct = Math.abs(measuredVal - baselineVal) / baselineVal * 100;
    }

    const flagged = deviationPct > markerTolerance;
    score += deviationPct;

    perMarker.push({
      marker,
      baseline: baselineVal,
      measured: measuredVal,
      deviationPct,
      flagged,
    });
  }

  const exceeded = score >= driftScoreMax;
  return { score, perMarker, exceeded };
}
