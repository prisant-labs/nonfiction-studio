// what-it-is:   deterministic eight-marker voice-drift engine
// what-it-does: measures the eight-marker stylometry vector for one chapter or an aggregate
//               book, then computes a drift score against a stored baseline. The score is an
//               unweighted sum of per-marker deviations, each capped so no single marker can
//               contribute more than one third of the configured drift budget (roadmap row 1.7,
//               voice registers). type_token_ratio is a moving average over a fixed
//               TTR_WINDOW_SIZE-token window, which makes it length-invariant; scoring against a
//               baseline captured under a different marker_set_version fails rather than
//               silently misreading the numbers.
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

// Per-marker contribution bound, expressed as a divisor of the configured drift budget
// rather than an absolute number (Correction B, roadmap row 1.7, voice registers): no
// single marker's CONTRIBUTION to the score may exceed one third of
// thresholds.drift_score_max, so at least three markers must deviate substantially before
// their combined contribution can breach the gate. The bound scales with whatever budget a
// project configures; deviationPct itself is never capped, only what it adds to score.
const MARKER_CONTRIBUTION_DIVISOR = 3;

// Default drift budget applied when thresholds.drift_score_max is absent from config.json
// (computeDrift's own fallback, below). Recalibrated from 35 to 25 against a committed,
// labeled scenario suite (tests/engines/fixtures/drift-scenarios/, exercised by
// tests/engines/stylometry-calibration.test.mjs) after Correction A (the type_token_ratio
// length-invariance fix) shrank the drift score's scale by roughly an order of magnitude
// without a matching budget change, which let a chapter stripped of every contraction and
// every first-person pronoun -- the canonical ghostwriting signature -- pass at 35 (score
// 33.58) while still blocking at 25 (score 26.91).
//
// Two other levers were measured against the same suite. A smaller MARKER_CONTRIBUTION_
// DIVISOR (currently 3, unchanged) does not separate the ghostwriting signature from natural
// between-chapter voice variation AT THIS BUDGET (35, nor at 25): both are dominated by two
// markers pinned at the per-marker bound plus a residual, and at a fixed budget the residual
// gap between them does not narrow as the divisor changes alone. That is NOT the same as "no
// divisor separates them" -- it does not, at a fixed budget. Separation DOES exist in the
// joint (budget, divisor) space: honest variation's score has a hard ceiling (47.09 for one
// golden chapter measured against the de-padded two-chapter self-fit baseline, reached once
// the per-marker cap exceeds its largest single deviation), while the ghostwriting
// signature's two saturated markers keep climbing linearly with the cap, so at a budget above
// that ceiling the two curves cross. This task verified a working point (budget 50, divisor
// 2.5) that blocks the ghostwriting signature while passing both de-padded chapters, with
// two markers alone (40) still comfortably short of budget. It was not pursued for the
// shipped default for three reasons: the feasible band shrinks fast as the divisor approaches
// 3 (a few points wide near divisor 2.5, empty by divisor 2.6 in this task's own search), the
// low end of the feasible divisor range (near 2) makes two markers alone nearly sufficient to
// block on their own, which is the guarantee this bound exists to prevent, and any divisor
// change ripples into every document and fixture that quotes "one third" or a divisor-derived
// number, including examples/fixtures/voice-drift/PLANTED.md's per-marker contribution table.
// Damping the per-marker bound by each marker's raw occurrence count was rejected because the
// ghostwriting signature lives on the two SPARSEST markers in the vector (contraction_rate
// and first_person_rate); any damping that shrinks toward zero as occurrence count shrinks
// lowers exactly those two markers' contribution, moving the signature further from blocking
// rather than closer -- the wrong direction for the one case this recalibration had to fix.
//
// A second, independently measured finding narrows what "25" is actually doing: at this
// budget, the ghostwriting signature's genuine knock-on in the six markers the transformation
// does not directly touch is about 6.05 points (measured against chapter 1's own true
// baseline, removing the population-mismatch floor entirely) -- short of the roughly 8.33
// points needed to block on its own. The other roughly 4.2 points that make it block come
// from the same population-mismatch floor every chapter carries when scored against a
// same-book self-fit baseline (10.86 points for an unchanged chapter). The calibration works
// on this suite partly by leaning on that floor, not solely on the transformation's own
// signal.
//
// This constant is the single source of truth for the shipped default:
// hooks/lib/status-engine.mjs, hooks/lib/gate-engine.mjs, and bin/ns-stylometry all import
// it rather than each carrying their own literal.
export const DEFAULT_DRIFT_SCORE_MAX = 25;

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
export const CURRENT_MARKER_SET_VERSION = 4;

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
 * remedy is always the same: re-run capture-voice to recapture the baseline with the
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
 * Computes the drift score and per-marker analysis by comparing a measured
 * vector against the stored baseline.
 *
 * Drift formula (TSK-022 report as amended by roadmap row 1.7's two corrections):
 *   deviationPct  = |measured - baseline| / baseline * 100            (honest, uncapped)
 *   contribution  = min(deviationPct, thresholds.drift_score_max / MARKER_CONTRIBUTION_DIVISOR)
 *   score         = SUM of contribution across all markers in the baseline
 * The score is an unweighted sum: every marker's (bounded) contribution counts equally;
 * "weighted" would mean some markers count for more than others, which is not this formula.
 * deviationPct is always reported honest and uncapped, so a later explain step can name the
 * real deviation and say it was capped; only the running score total is bounded, never the
 * reported per-marker deviation itself.
 *
 * Each per-marker record also carries its actual contribution (the bounded amount that marker
 * added to score -- identical to deviationPct when capped is false, equal to
 * maxMarkerContribution when capped is true), and the function returns maxMarkerContribution
 * itself (the per-marker bound in absolute terms, driftScoreMax / MARKER_CONTRIBUTION_DIVISOR)
 * so a caller can render an explain view without re-deriving the bound or importing the
 * divisor, which stays a private implementation detail of this module.
 *
 * Zero-baseline rule per brief:
 *   when baseline === 0: deviationPct = 0 if measured === 0, else 100
 *
 * A marker is flagged when its deviationPct (the honest value, not the capped
 * contribution) exceeds the per-marker tolerance band (thresholds.stylometry_marker_tolerance,
 * default 2.0).
 *
 * Stale-baseline guard: baseline.marker_set_version must equal CURRENT_MARKER_SET_VERSION.
 * A baseline object missing the field entirely is treated as version 1. A mismatch throws
 * StaleBaselineError rather than scoring a baseline whose type_token_ratio values mean
 * something different under the current engine (Correction A changed what a stored
 * type_token_ratio number means, from a flat ratio to a windowed moving average).
 *
 * @param {object} measured   - marker vector from measureBook or measureChapter
 * @param {object} baseline   - the stored stylometry.baseline object from config.json,
 *   shaped { markers: {...8 markers}, marker_set_version?: number, ...other fields }.
 *   This is NOT just the markers sub-object: marker_set_version lives alongside markers,
 *   not inside it, and computeDrift needs both to score safely.
 * @param {object} thresholds - thresholds block from config.json
 * @returns {{ score: number, perMarker: object[], exceeded: boolean, maxMarkerContribution: number,
 *   markerTolerance: number }}
 *   perMarker entries carry { marker, baseline, measured, deviationPct, contribution, capped, flagged }.
 *   markerTolerance is the per-marker tolerance band (thresholds.stylometry_marker_tolerance,
 *   default 2.0) that flagged is computed against, returned for the same reason
 *   maxMarkerContribution is: so a caller can state the number a boolean was compared against,
 *   not just the boolean itself.
 * @throws {StaleBaselineError} when baseline.marker_set_version does not match
 *   CURRENT_MARKER_SET_VERSION
 */
export function computeDrift(measured, baseline, thresholds) {
  const markerTolerance = (thresholds && thresholds.stylometry_marker_tolerance != null)
    ? thresholds.stylometry_marker_tolerance
    : 2.0;
  const driftScoreMax = (thresholds && thresholds.drift_score_max != null)
    ? thresholds.drift_score_max
    : DEFAULT_DRIFT_SCORE_MAX;
  const maxMarkerContribution = driftScoreMax / MARKER_CONTRIBUTION_DIVISOR;

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
      'capture-voice to re-capture the baseline with the corrected engine'
    );
  }

  const perMarker = [];
  let score = 0;

  for (const marker of Object.keys(markers)) {
    const baselineVal = markers[marker];
    const measuredVal = (measured != null && marker in measured) ? measured[marker] : 0;

    let deviationPct;
    if (baselineVal === 0) {
      deviationPct = measuredVal === 0 ? 0 : 100;
    } else {
      deviationPct = Math.abs(measuredVal - baselineVal) / baselineVal * 100;
    }

    const capped = deviationPct > maxMarkerContribution;
    const contribution = capped ? maxMarkerContribution : deviationPct;
    const flagged = deviationPct > markerTolerance;
    score += contribution;

    perMarker.push({
      marker,
      baseline: baselineVal,
      measured: measuredVal,
      deviationPct,
      contribution,
      capped,
      flagged,
    });
  }

  const exceeded = score >= driftScoreMax;
  return { score, perMarker, exceeded, maxMarkerContribution, markerTolerance };
}
