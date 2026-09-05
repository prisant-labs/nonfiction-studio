// what-it-is:   the local n-gram overlap detection engine
// what-it-does: exports findOverlaps(chapters, corpora, { minWords }), which normalizes each
//               chapter and each corpus text (Unicode NFC, case-fold, typographic-to-straight
//               quotes, whitespace-run collapse), tokenizes on whitespace, builds 8-word shingles,
//               and chains matching shingles into maximal spans; a merged span of at least
//               minWords (default 15) words becomes a finding naming both the chapter location
//               and the corpus location. A chapter span that sits inside a quoted-and-anchored
//               span ([quote: EV-nnnn], the grammar hooks/lib/claims-engine.mjs already parses for
//               quote fidelity) is excluded as properly quoted rather than flagged, and counted
//               instead in the return value's `excluded` field - an informational count, never a
//               silent drop. Also exports discoverCorpora(root), the shared corpus-discovery walk
//               over research/packets/*.md, the verbatim field values in research/evidence-log.md,
//               and (when present) context/prior-work/*.md, all enumerated in sorted filename
//               order, so bin/ns-overlap and a future quality-gate check build the identical
//               corpus set from the identical code rather than two independent copies.
// why:          an author's own already-approved research material (a packet, a saved verbatim
//               excerpt, an old draft) is the one corpus this check can search with no network
//               access and no third-party licensing question; findOverlaps is a pure function so
//               it is directly unit-testable, and discoverCorpora is the one place that decides
//               which files count as that corpus, so the CLI and a later gate check cannot drift
//               apart on what "the corpus" means
// used-by:      bin/ns-overlap

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseEvidenceLog } from './ledger.mjs';
import { findQuoteAnchorSpans } from './claims-engine.mjs';

// ---- constants -------------------------------------------------------------------

export const SHINGLE_SIZE = 8;
export const DEFAULT_MIN_WORDS = 15;
const EXCERPT_WORD_CAP = 40;

// ---- normalization (P6): NFC, case-fold, typographic-to-straight quotes ----------
// Whitespace-run collapse and tokenization are one step below (tokenizeWithOffsets):
// splitting on runs of \s (which, per the ECMAScript spec, includes NBSP U+00A0)
// already collapses any run of whitespace between tokens, so there is no separate
// "collapse" pass over the whole string - the tokenizer performs it directly. NFC
// normalization is applied once to the whole text before tokenizing (so token
// offsets are stable), and case-fold plus quote-straightening are applied per
// token below, which is equivalent to applying them to the whole string first:
// neither operation crosses a whitespace boundary or changes one.

// Curly single-quote family (left/right single quote, low-9 quote, prime) -> '
const CURLY_SINGLE_RE = /[\u2018\u2019\u201A\u2032]/g;
// Curly double-quote family (left/right double quote, low-9 double quote, double prime) -> "
const CURLY_DOUBLE_RE = /[\u201C\u201D\u201E\u2033]/g;

function normalizeWord(raw) {
  return raw.replace(CURLY_SINGLE_RE, "'").replace(CURLY_DOUBLE_RE, '"').toLowerCase();
}

/**
 * Tokenizes NFC-normalized text on whitespace, returning each token's normalized
 * word form alongside its character offset range [start, end) in `text`. The
 * offsets are what let computeQuotedTokenRanges map a quote-anchor's character
 * range (found on the same NFC text, via findQuoteAnchorSpans) onto a token index
 * range for the exclusion rule.
 *
 * @param {string} text - NFC-normalized text (chapter.text.normalize('NFC') or corpus text)
 * @returns {{word: string, start: number, end: number}[]}
 */
function tokenizeWithOffsets(text) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ word: normalizeWord(m[0]), start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

// ---- shingling and maximal-span chaining -----------------------------------------

function shingleKey(tokens, start) {
  const parts = new Array(SHINGLE_SIZE);
  for (let k = 0; k < SHINGLE_SIZE; k++) parts[k] = tokens[start + k].word;
  return parts.join('\u0001');
}

/**
 * Finds every maximal merged span shared between chapterTokens and sourceTokens.
 *
 * Two 8-word shingles at chapter position i and source position j are the "same
 * diagonal" (j - i). Consecutive chapter positions on the same diagonal (i, i+1,
 * i+2, ...) are exactly consecutive OVERLAPPING shingle hits, which is the P6
 * merge rule: a run of k chained shingles covers k + (SHINGLE_SIZE - 1) words,
 * since each additional shingle in the chain extends the span by exactly one
 * word. A single, unchained shingle (k=1) is an 8-word span; the brief's worked
 * example (23 chained shingles -> one 30-word span) is k=23: 23 + 7 = 30.
 *
 * Grouping hits by diagonal and then scanning each diagonal's chapter positions
 * for consecutive runs is equivalent to, and simpler than, incremental chain
 * tracking, and gives the same maximal spans deterministically regardless of
 * traversal order.
 *
 * @param {{word:string,start:number,end:number}[]} chapterTokens
 * @param {{word:string,start:number,end:number}[]} sourceTokens
 * @returns {{chapterStart:number, sourceStart:number, words:number}[]} spans of any
 *   length >= SHINGLE_SIZE; minWords filtering happens in findOverlaps
 */
function findMatches(chapterTokens, sourceTokens) {
  const sourceIndex = new Map();
  for (let j = 0; j + SHINGLE_SIZE <= sourceTokens.length; j++) {
    const key = shingleKey(sourceTokens, j);
    let arr = sourceIndex.get(key);
    if (!arr) { arr = []; sourceIndex.set(key, arr); }
    arr.push(j);
  }

  // diagonal (j - i) -> ascending array of chapter start positions i that hit it.
  // Ascending because the outer loop below visits i in increasing order.
  const hitsByDiagonal = new Map();
  for (let i = 0; i + SHINGLE_SIZE <= chapterTokens.length; i++) {
    const key = shingleKey(chapterTokens, i);
    const positions = sourceIndex.get(key);
    if (!positions) continue;
    for (const j of positions) {
      const diag = j - i;
      let arr = hitsByDiagonal.get(diag);
      if (!arr) { arr = []; hitsByDiagonal.set(diag, arr); }
      arr.push(i);
    }
  }

  const spans = [];
  for (const [diag, positions] of hitsByDiagonal) {
    let runStart = positions[0];
    let prev = positions[0];
    for (let k = 1; k < positions.length; k++) {
      const cur = positions[k];
      if (cur === prev + 1) {
        prev = cur;
        continue;
      }
      spans.push({ chapterStart: runStart, sourceStart: runStart + diag, words: (prev - runStart) + SHINGLE_SIZE });
      runStart = cur;
      prev = cur;
    }
    spans.push({ chapterStart: runStart, sourceStart: runStart + diag, words: (prev - runStart) + SHINGLE_SIZE });
  }
  return spans;
}

// ---- quoted-span exclusion --------------------------------------------------------

/**
 * Maps each quote-anchor's character range (from findQuoteAnchorSpans, run on the
 * same NFC-normalized text these tokens were built from) onto a token index range
 * [start, end): the maximal run of tokens fully contained in the quoted span's
 * character range. Boundary tokens that carry an attached quotation mark (the
 * opening or closing straight quote sits directly against the first or last
 * quoted word, with no space, as ordinary prose writes it) are NOT fully
 * contained and are correctly excluded from the range - only the words strictly
 * between the quote marks count as "properly quoted" for the containment check
 * in findOverlaps.
 *
 * @param {{word:string,start:number,end:number}[]} tokens
 * @param {string} normalizedText - the same NFC text `tokens` was built from
 * @returns {{start:number, end:number}[]}
 */
function computeQuotedTokenRanges(tokens, normalizedText) {
  const ranges = [];
  for (const anchor of findQuoteAnchorSpans(normalizedText)) {
    if (anchor.spanStart == null || anchor.spanEnd == null) continue;
    let start = null;
    let end = null;
    for (let idx = 0; idx < tokens.length; idx++) {
      const t = tokens[idx];
      if (t.start >= anchor.spanStart && t.end <= anchor.spanEnd) {
        if (start === null) start = idx;
        end = idx + 1;
      } else if (start !== null && t.start >= anchor.spanEnd) {
        break;
      }
    }
    if (start !== null) ranges.push({ start, end });
  }
  return ranges;
}

// ---- excerpts ----------------------------------------------------------------------

/**
 * Builds a finding excerpt from the normalized token stream, capped at
 * EXCERPT_WORD_CAP (40) words. The excerpt is reconstructed from normalized
 * tokens (lowercased, quote-straightened), matching the offsets it is reported
 * alongside, which are also over the normalized token stream.
 */
function buildExcerpt(tokens, start, words) {
  const cap = Math.min(words, EXCERPT_WORD_CAP);
  const slice = new Array(cap);
  for (let k = 0; k < cap; k++) slice[k] = tokens[start + k].word;
  const text = slice.join(' ');
  return words > EXCERPT_WORD_CAP ? text + ' ...' : text;
}

// ---- findOverlaps ------------------------------------------------------------------

/**
 * Finds n-gram overlap between each chapter and each corpus text.
 *
 * @param {{file: string, text: string}[]} chapters - manuscript chapters (bible-relative
 *   `file` path, e.g. 'chapters/01-x.md')
 * @param {{source: string, text: string}[]} corpora - author-owned reference texts (a
 *   `source` identifier, e.g. 'research/packets/01-x.md' or
 *   'research/evidence-log.md#EV-0001'), typically built by discoverCorpora
 * @param {{minWords?: number}} [opts] - minWords defaults to DEFAULT_MIN_WORDS (15)
 * @returns {{findings: object[], excluded: number}} findings sorted by chapter, then
 *   source, then chapterSpan.start, for deterministic output regardless of input
 *   array order; excluded counts the number of UNIQUE (chapter, span) regions that
 *   would otherwise have flagged but sit inside a quoted-and-anchored span - counted
 *   once per region even when more than one corpus source independently matches the
 *   same properly-quoted text, since the informational count answers "how many
 *   passages did I properly quote," not "how many corpus texts happen to contain
 *   the same passage."
 */
export function findOverlaps(chapters, corpora, { minWords = DEFAULT_MIN_WORDS } = {}) {
  const findings = [];
  const excludedSpans = new Set();

  const preparedCorpora = corpora.map(c => ({
    source: c.source,
    tokens: tokenizeWithOffsets(c.text.normalize('NFC')),
  }));

  for (const chapter of chapters) {
    const normText = chapter.text.normalize('NFC');
    const tokens = tokenizeWithOffsets(normText);
    const quotedRanges = computeQuotedTokenRanges(tokens, normText);

    for (const src of preparedCorpora) {
      const spans = findMatches(tokens, src.tokens);
      for (const span of spans) {
        if (span.words < minWords) continue;

        const chapterEnd = span.chapterStart + span.words;
        const sourceEnd = span.sourceStart + span.words;

        const excluded = quotedRanges.some(
          r => r.start <= span.chapterStart && chapterEnd <= r.end
        );
        if (excluded) {
          excludedSpans.add(chapter.file + '\u0001' + span.chapterStart + '\u0001' + chapterEnd);
          continue;
        }

        findings.push({
          chapter: chapter.file,
          chapterSpan: {
            start: span.chapterStart,
            end: chapterEnd,
            excerpt: buildExcerpt(tokens, span.chapterStart, span.words),
          },
          source: src.source,
          sourceSpan: {
            start: span.sourceStart,
            end: sourceEnd,
            excerpt: buildExcerpt(src.tokens, span.sourceStart, span.words),
          },
          words: span.words,
        });
      }
    }
  }

  findings.sort((a, b) =>
    a.chapter.localeCompare(b.chapter) ||
    a.source.localeCompare(b.source) ||
    a.chapterSpan.start - b.chapterSpan.start
  );

  return { findings, excluded: excludedSpans.size };
}

// ---- corpus discovery ----------------------------------------------------------------

/**
 * Discovers the local, author-owned overlap corpus under a book root: every
 * research/packets/*.md file, every non-empty `verbatim` field in
 * research/evidence-log.md, and (when the directory exists) every
 * context/prior-work/*.md file. No network access; a missing directory or
 * missing evidence-log.md simply contributes nothing, rather than erroring, so
 * the check stays usable before any research exists. Each group is enumerated
 * in sorted filename order (or, for ledger entries, sorted by EV id) so two
 * runs over an unchanged tree produce an identical corpus in an identical order,
 * independent of directory-listing order.
 *
 * @param {string} root - absolute path to the book root
 * @returns {{source: string, text: string}[]}
 */
export function discoverCorpora(root) {
  const corpora = [];

  const packetsDir = join(root, 'research', 'packets');
  if (existsSync(packetsDir)) {
    const files = readdirSync(packetsDir).filter(f => f.endsWith('.md')).sort();
    for (const f of files) {
      corpora.push({
        source: 'research/packets/' + f,
        text: readFileSync(join(packetsDir, f), 'utf8'),
      });
    }
  }

  const ledgerPath = join(root, 'research', 'evidence-log.md');
  if (existsSync(ledgerPath)) {
    const entries = parseEvidenceLog(readFileSync(ledgerPath, 'utf8'));
    const withVerbatim = entries
      .filter(e => e.verbatim != null && e.verbatim !== '')
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const e of withVerbatim) {
      corpora.push({
        source: 'research/evidence-log.md#' + e.id,
        text: e.verbatim,
      });
    }
  }

  const priorWorkDir = join(root, 'context', 'prior-work');
  if (existsSync(priorWorkDir)) {
    const files = readdirSync(priorWorkDir).filter(f => f.endsWith('.md')).sort();
    for (const f of files) {
      corpora.push({
        source: 'context/prior-work/' + f,
        text: readFileSync(join(priorWorkDir, f), 'utf8'),
      });
    }
  }

  return corpora;
}
