// what-it-is:   claim marker scanner and coverage engine
// what-it-does: scans chapter text for the three marker forms ([claim: EV-NNNN], [UNVERIFIED],
//               [SOURCE-UNVERIFIABLE]), resolves each [claim:] marker against the evidence ledger,
//               and computes per-chapter and book-level coverage statistics with open-claim findings
// why:          the engine logic lives in a lib module so both bin/ns-claims (CLI) and the Stop
//               gate hook share the same computation path per S-07 section 4
// used-by:      bin/ns-claims, hooks/stop-gate.mjs, hooks/lib/gate-engine.mjs (computeCoverage,
//               scanChapter, scanQuoteAnchors, computeQuoteFindings), hooks/lib/doctor-engine.mjs
//               (scanChapter), and hooks/lib/overlap-engine.mjs (findQuoteAnchorSpans, for its
//               quoted-span exclusion rule)

import { resolvedStatuses } from './ledger.mjs';

// Regex patterns for the three marker forms (S-08 section 8 grammar, docs/formats/claim-markers.md).
// All three are used with /g so lastIndex must be reset before each per-line application.
const CLAIM_RE = /\[claim: (EV-\d{4})\]/g;
const UNVERIFIED_RE = /\[UNVERIFIED\]/g;
const SOURCE_UNVERIFIABLE_RE = /\[SOURCE-UNVERIFIABLE\]/g;

// Non-global version used for the orphan-detection test on each line (no lastIndex concern).
const LINE_HAS_CLAIM_RE = /\[claim: EV-\d{4}\]/;

/**
 * Scans chapter text for all three marker forms and resolves each [claim: EV-NNNN]
 * marker against the provided evidence ledger entries.
 *
 * Returns one resolution object per marker occurrence on any line.
 *
 * Counting rules (docs/formats/claim-markers.md coverage computation):
 *   - [claim: EV-NNNN] resolves when its EV entry exists and status is in resolvedStatuses.
 *     Missing entry or status not in resolvedStatuses (pending, unverified, source-unverifiable)
 *     yields an unresolved marker.
 *   - [UNVERIFIED] is always unresolved (one open claim per occurrence).
 *   - orphan [SOURCE-UNVERIFIABLE] (no paired [claim: EV-NNNN] on the same line) is unresolved.
 *   - paired [SOURCE-UNVERIFIABLE] is NOT counted separately; its paired [claim:] marker
 *     will already be unresolved (status source-unverifiable is not in resolvedStatuses).
 *
 * @param {string}   text          - full chapter file content
 * @param {object[]} ledgerEntries - parsed EV entry array from parseEvidenceLog (ledger.mjs)
 * @returns {object[]} marker resolution array; each element:
 *   { form: 'claim'|'unverified'|'source-unverifiable',
 *     id: string|null, line: number, resolved: boolean,
 *     status: string|null, reason: string|null, orphan?: boolean }
 */
export function scanChapter(text, ledgerEntries) {
  // Build O(1) lookup from EV ID to its entry object.
  const ledgerMap = new Map();
  for (const entry of ledgerEntries) {
    ledgerMap.set(entry.id, entry);
  }

  const lines = text.split('\n');
  const markers = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // 1-based

    // Form 1: [claim: EV-NNNN]
    CLAIM_RE.lastIndex = 0;
    let m;
    while ((m = CLAIM_RE.exec(line)) !== null) {
      const id = m[1];
      const entry = ledgerMap.get(id);
      let resolved, status, reason;
      if (!entry) {
        resolved = false;
        status = null;
        reason = id + ' not found in research/evidence-log.md';
      } else {
        status = entry.status;
        if (resolvedStatuses.has(status)) {
          resolved = true;
          reason = null;
        } else {
          resolved = false;
          reason = id + ' has status: ' + status;
        }
      }
      markers.push({ form: 'claim', id, line: lineNum, resolved, status, reason });
    }

    // Form 2: [UNVERIFIED]
    UNVERIFIED_RE.lastIndex = 0;
    while ((m = UNVERIFIED_RE.exec(line)) !== null) {
      markers.push({
        form: 'unverified',
        id: null,
        line: lineNum,
        resolved: false,
        status: null,
        reason: '[UNVERIFIED] tag: no evidence entry yet'
      });
    }

    // Form 3: [SOURCE-UNVERIFIABLE]
    // Only orphan occurrences (no [claim: EV-NNNN] on the same line) count as open claims.
    // Per placement rule 5 in docs/formats/claim-markers.md (fail-safe on malformed input).
    SOURCE_UNVERIFIABLE_RE.lastIndex = 0;
    const lineHasClaim = LINE_HAS_CLAIM_RE.test(line);
    while ((m = SOURCE_UNVERIFIABLE_RE.exec(line)) !== null) {
      if (!lineHasClaim) {
        // Orphan: grammar error; count as one open claim as a fail-safe.
        markers.push({
          form: 'source-unverifiable',
          id: null,
          line: lineNum,
          resolved: false,
          orphan: true,
          status: null,
          reason: 'orphan [SOURCE-UNVERIFIABLE]: no paired [claim: EV-nnnn] on this line'
        });
      }
      // Paired [SOURCE-UNVERIFIABLE]: the paired [claim: EV-NNNN] marker is already unresolved
      // (its entry status is source-unverifiable, which is not in resolvedStatuses).
      // Do not emit a separate marker entry for the tag itself.
    }
  }

  return markers;
}

/**
 * Computes book-level or multi-chapter coverage from an array of pre-scanned chapter results.
 *
 * coveragePct = (resolved markers / total markers) * 100; returns 100.0 when total is zero.
 *
 * @param {object[]} chapters - array of { file: string, markers: object[] }
 *   where markers is the return value of scanChapter
 * @param {object[]} [ledger] - parsed evidence entries from parseEvidenceLog;
 *   not re-resolved here (scanChapter already resolved), carried for caller convenience
 * @returns {{ coveragePct: number, openClaims: number, findings: object[],
 *             totalMarkers: number, resolvedCount: number, chapters: object[] }}
 */
export function computeCoverage(chapters, ledger) {
  let totalMarkers = 0;
  let resolvedCount = 0;
  const findings = [];
  const chapterSummaries = [];

  for (const chapter of chapters) {
    const { file, markers } = chapter;
    let chapterResolved = 0;

    for (const marker of markers) {
      if (marker.resolved) {
        chapterResolved++;
      } else {
        findings.push({
          file,
          line: marker.line,
          type: 'claim_coverage.' + marker.form,
          excerpt: buildExcerpt(marker),
          detail: marker.reason
        });
      }
    }

    const chapterTotal = markers.length;
    const chapterOpen = chapterTotal - chapterResolved;
    totalMarkers += chapterTotal;
    resolvedCount += chapterResolved;

    const chapterPct = chapterTotal === 0 ? 100.0 : (chapterResolved / chapterTotal) * 100;
    chapterSummaries.push({
      file,
      totalMarkers: chapterTotal,
      resolvedCount: chapterResolved,
      openClaims: chapterOpen,
      coveragePct: chapterPct
    });
  }

  const coveragePct = totalMarkers === 0 ? 100.0 : (resolvedCount / totalMarkers) * 100;

  return {
    coveragePct,
    openClaims: totalMarkers - resolvedCount,
    findings,
    totalMarkers,
    resolvedCount,
    chapters: chapterSummaries
  };
}

/**
 * Returns a short inline text excerpt for a marker, used in finding records.
 *
 * @param {object} marker - a resolution object from scanChapter
 * @returns {string}
 */
function buildExcerpt(marker) {
  if (marker.form === 'claim') return '[claim: ' + marker.id + ']';
  if (marker.form === 'unverified') return '[UNVERIFIED]';
  return '[SOURCE-UNVERIFIABLE]';
}

// --- Quote fidelity ---------------------------------------------------------------
// OPP-D03 (quote fidelity and source packets). Fourth marker form, [quote: EV-NNNN]
// (docs/formats/claim-markers.md), anchors a quoted span in chapter prose to the
// verbatim excerpt stored on the referenced EV entry. Comparison is character-for-
// character with NO normalization: normalizing typographic quotes, Unicode forms,
// ellipses, or OCR/transcript cleanup here would hide exactly the mismatch classes
// the deferred normalization and adjudication policy (roadmap row 1.5) has to
// adjudicate. Block mode is not implemented anywhere in this module by design; see
// the structural coercion in hooks/lib/gate-engine.mjs.

const QUOTE_ANCHOR_RE = /\[quote: (EV-\d{4})\]/g;

// Between the closing quotation mark and the anchor, only whitespace and
// sentence-terminal punctuation (period, question mark, exclamation mark) is
// allowed, per the placement rule documented in docs/formats/claim-markers.md.
const QUOTE_GAP_RE = /^[\s.!?]*$/;

/**
 * Finds the character range [start, end) of the quoted span, if any, that
 * immediately precedes a [quote: EV-nnnn] anchor.
 *
 * The span is the text between the nearest preceding pair of straight double
 * quotation marks (") whose closing mark is separated from the anchor by nothing
 * but whitespace and/or sentence-terminal punctuation. Returns null when no such
 * pair precedes the anchor (no closing quote found, or something other than
 * whitespace/terminal punctuation sits in the gap, or there is no matching
 * opening quote before the closing one).
 *
 * This is the single implementation of the quote-anchor grammar's span-finding
 * rule: findPrecedingQuotedSpan (string result, used by scanQuoteAnchors via
 * findQuoteAnchorSpans below) and findQuoteAnchorSpans (offset-aware result,
 * imported by hooks/lib/overlap-engine.mjs for its quoted-span exclusion rule)
 * both delegate to this function rather than re-implementing the gap/pairing rule.
 *
 * @param {string} text        - full chapter text
 * @param {number} anchorStart - character offset where the '[quote: ' anchor begins
 * @returns {{start: number, end: number}|null}
 */
function findPrecedingQuotedSpanRange(text, anchorStart) {
  const before = text.slice(0, anchorStart);
  const closeIdx = before.lastIndexOf('"');
  if (closeIdx === -1) return null;

  const gap = before.slice(closeIdx + 1);
  if (!QUOTE_GAP_RE.test(gap)) return null;

  const openIdx = before.lastIndexOf('"', closeIdx - 1);
  if (openIdx === -1) return null;

  return { start: openIdx + 1, end: closeIdx };
}

/**
 * Finds the quoted span, if any, that immediately precedes a [quote: EV-nnnn]
 * anchor, as a string. See findPrecedingQuotedSpanRange for the grammar.
 *
 * @param {string} text        - full chapter text
 * @param {number} anchorStart - character offset where the '[quote: ' anchor begins
 * @returns {string|null}
 */
function findPrecedingQuotedSpan(text, anchorStart) {
  const range = findPrecedingQuotedSpanRange(text, anchorStart);
  return range ? text.slice(range.start, range.end) : null;
}

/**
 * Scans text for every [quote: EV-nnnn] anchor and returns its preceding quoted
 * span, both as a string and as character offsets - independent of the evidence
 * ledger. This is the anchor-scanning grammar shared with scanQuoteAnchors (which
 * layers ledger evaluation on top of this) and is imported directly by
 * hooks/lib/overlap-engine.mjs for its quoted-span exclusion rule: a chapter span
 * that sits inside a quoted-and-anchored span is excluded from the overlap engine's
 * findings as properly quoted, regardless of whether the anchor's EV id resolves
 * in the ledger (that separate question is quote-fidelity's job, not overlap's).
 *
 * @param {string} text - full chapter text
 * @returns {object[]} one entry per anchor, in document order:
 *   { id: string, index: number, line: number, span: string|null,
 *     spanStart: number|null, spanEnd: number|null }
 *   span/spanStart/spanEnd are null when no valid preceding quoted span is found.
 */
export function findQuoteAnchorSpans(text) {
  const results = [];
  QUOTE_ANCHOR_RE.lastIndex = 0;
  let m;
  while ((m = QUOTE_ANCHOR_RE.exec(text)) !== null) {
    const range = findPrecedingQuotedSpanRange(text, m.index);
    results.push({
      id: m[1],
      index: m.index,
      line: lineNumberAt(text, m.index),
      span: range ? text.slice(range.start, range.end) : null,
      spanStart: range ? range.start : null,
      spanEnd: range ? range.end : null,
    });
  }
  return results;
}

/**
 * Returns the 1-based line number containing the given character offset.
 *
 * @param {string} text
 * @param {number} index
 * @returns {number}
 */
function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

/**
 * Builds a word-level diff string between the stored verbatim excerpt and the
 * quoted span found in the chapter. Trims the common prefix and common suffix
 * (split on whitespace) so only the differing words remain visible, in context.
 * This is a display aid only; the comparison that decides mismatch vs. match is
 * always the exact string equality check in scanQuoteAnchors, never this diff.
 *
 * @param {string} expected - entry.verbatim (the stored excerpt)
 * @param {string} actual   - the quoted span found in the chapter
 * @returns {string} human-readable diff, e.g. verbatim: "...the [session.]" vs quoted: "...the [exam.]"
 */
function buildQuoteDiff(expected, actual) {
  const expWords = expected.split(/\s+/).filter(Boolean);
  const actWords = actual.split(/\s+/).filter(Boolean);

  let prefixLen = 0;
  while (
    prefixLen < expWords.length &&
    prefixLen < actWords.length &&
    expWords[prefixLen] === actWords[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < expWords.length - prefixLen &&
    suffixLen < actWords.length - prefixLen &&
    expWords[expWords.length - 1 - suffixLen] === actWords[actWords.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const expMiddle = expWords.slice(prefixLen, expWords.length - suffixLen);
  const actMiddle = actWords.slice(prefixLen, actWords.length - suffixLen);
  const prefix = expWords.slice(0, prefixLen).join(' ');
  const suffix = suffixLen > 0 ? expWords.slice(expWords.length - suffixLen).join(' ') : '';

  const truncateStart = s => (s.length > 40 ? '...' + s.slice(-40) : s);
  const truncateEnd = s => (s.length > 40 ? s.slice(0, 40) + '...' : s);

  const render = middle => {
    const parts = [];
    if (prefix) parts.push(truncateStart(prefix));
    parts.push('[' + (middle.join(' ') || '(nothing)') + ']');
    if (suffix) parts.push(truncateEnd(suffix));
    return parts.join(' ');
  };

  return 'verbatim: "' + render(expMiddle) + '" vs quoted: "' + render(actMiddle) + '"';
}

/**
 * Scans chapter text for every [quote: EV-nnnn] anchor and evaluates it against
 * the evidence ledger and its preceding quoted span, per docs/formats/claim-markers.md
 * (marker form 4) and the OPP-D03 quote-fidelity check.
 *
 * Evaluation order per anchor (first failing check wins, so every anchor produces exactly
 * one status):
 *   1. EV entry absent from the ledger          -> status 'missing-entry'
 *   2. EV entry present but has no verbatim      -> status 'no-excerpt'
 *   3. No quoted span precedes the anchor        -> status 'no-span'
 *   4. Quoted span differs from verbatim         -> status 'mismatch' (diff populated)
 *   5. Quoted span equals verbatim exactly       -> status 'ok'
 *
 * @param {string}   text          - full chapter file content
 * @param {object[]} ledgerEntries - parsed EV entry array from parseEvidenceLog (ledger.mjs)
 * @returns {object[]} one entry per anchor, in document order:
 *   { id: string, line: number, entry: object|null, span: string|null,
 *     status: 'ok'|'missing-entry'|'no-excerpt'|'no-span'|'mismatch',
 *     reason: string|null, diff: string|null }
 */
export function scanQuoteAnchors(text, ledgerEntries) {
  const ledgerMap = new Map();
  for (const entry of ledgerEntries) {
    ledgerMap.set(entry.id, entry);
  }

  const results = [];
  for (const { id, line, span } of findQuoteAnchorSpans(text)) {
    const entry = ledgerMap.get(id) || null;

    if (!entry) {
      results.push({
        id, line, entry: null, span: null, status: 'missing-entry',
        reason: id + ' not found in research/evidence-log.md', diff: null
      });
      continue;
    }

    const verbatim = entry.verbatim;
    if (verbatim == null || verbatim === '') {
      results.push({
        id, line, entry, span: null, status: 'no-excerpt',
        reason: id + ' has no verbatim field in research/evidence-log.md', diff: null
      });
      continue;
    }

    if (span == null) {
      results.push({
        id, line, entry, span: null, status: 'no-span',
        reason: 'no quoted span precedes [quote: ' + id + '] on line ' + line, diff: null
      });
      continue;
    }

    if (span !== verbatim) {
      results.push({
        id, line, entry, span, status: 'mismatch',
        reason: id + ' quoted span does not match the verbatim excerpt',
        diff: buildQuoteDiff(verbatim, span)
      });
      continue;
    }

    results.push({ id, line, entry, span, status: 'ok', reason: null, diff: null });
  }

  return results;
}

/**
 * Computes quote-fidelity findings across one or more pre-scanned chapters.
 * Mirrors computeCoverage's finding shape ({file, line, type, excerpt, detail})
 * so callers (bin/ns-claims, hooks/lib/gate-engine.mjs) can feed findings straight
 * into addFinding (report.mjs) or the same evidence-array formatting the other
 * checks use.
 *
 * @param {object[]} chapters - array of { file: string, anchors: object[] }
 *   where anchors is the return value of scanQuoteAnchors
 * @returns {{ findings: object[], totalAnchors: number }}
 */
export function computeQuoteFindings(chapters) {
  const findings = [];
  let totalAnchors = 0;

  for (const { file, anchors } of chapters) {
    totalAnchors += anchors.length;
    for (const a of anchors) {
      if (a.status === 'ok') continue;
      const detail = a.status === 'mismatch' ? (a.reason + ': ' + a.diff) : a.reason;
      findings.push({
        file,
        line: a.line,
        type: 'quote_fidelity.' + a.status,
        excerpt: '[quote: ' + a.id + ']',
        detail
      });
    }
  }

  return { findings, totalAnchors };
}

/**
 * Builds the Markdown content of a per-chapter research packet: one entry per
 * quote anchor, each carrying the EV id and handle, the claim text, the source
 * id with its locator, and the verbatim excerpt (OPP-D03 quote fidelity and
 * source packets). A missing locator or missing excerpt is shown explicitly,
 * never silently omitted, per the OPP-D03 acceptance bar ("one verbatim excerpt
 * per claim anchor, zero missing locators" means visible, not silent).
 *
 * Deterministic: the same chapterSlug and anchors array always produce
 * byte-identical output. No generation timestamp is stamped into the content -
 * a timestamp is exactly what would break byte-identical regeneration over an
 * unchanged ledger.
 *
 * @param {string}   chapterSlug
 * @param {object[]} anchors - return value of scanQuoteAnchors for this chapter
 * @returns {string} Markdown packet content
 */
export function buildResearchPacket(chapterSlug, anchors) {
  const lines = [];
  lines.push('# Research packet: ' + chapterSlug);
  lines.push('');
  lines.push(
    'One verbatim excerpt per `[quote: EV-nnnn]` anchor in `chapters/' + chapterSlug + '.md`, ' +
    'generated from `research/evidence-log.md`. Regenerate with `ns-claims --packets`; do not hand-edit.'
  );
  lines.push('');

  if (anchors.length === 0) {
    lines.push('No `[quote: EV-nnnn]` anchors found in this chapter.');
    lines.push('');
    return lines.join('\n');
  }

  for (const a of anchors) {
    if (!a.entry) {
      lines.push('## ' + a.id + ' (ledger entry not found)');
      lines.push('');
      lines.push('- line: ' + a.line);
      lines.push('- status: ' + a.status);
      lines.push('- claim: (EV entry not found in research/evidence-log.md)');
      lines.push('- source: (unknown; entry not found)');
      lines.push('- locator: (unknown; entry not found)');
      lines.push('- verbatim: (unknown; entry not found)');
      lines.push('');
      continue;
    }

    const e = a.entry;
    lines.push('## ' + a.id + ' (' + e.handle + ')');
    lines.push('');
    lines.push('- line: ' + a.line);
    lines.push('- status: ' + a.status);
    lines.push('- claim: ' + e.claim);
    lines.push('- source: ' + (e.source && e.source !== '' ? e.source : '(none)'));
    lines.push('- locator: ' + (e.locator && e.locator !== '' ? e.locator : '(missing locator)'));
    lines.push('- verbatim: ' + (e.verbatim && e.verbatim !== '' ? e.verbatim : '(no stored excerpt)'));
    if (a.status === 'mismatch') {
      lines.push('- diff: ' + a.diff);
    }
    lines.push('');
  }

  return lines.join('\n');
}
