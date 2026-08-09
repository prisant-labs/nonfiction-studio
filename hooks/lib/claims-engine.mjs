// what-it-is:   claim marker scanner and coverage engine
// what-it-does: scans chapter text for the three marker forms ([claim: EV-NNNN], [UNVERIFIED],
//               [SOURCE-UNVERIFIABLE]), resolves each [claim:] marker against the evidence ledger,
//               and computes per-chapter and book-level coverage statistics with open-claim findings
// why:          the engine logic lives in a lib module so both bin/ns-claims (CLI) and the Stop
//               gate hook share the same computation path per S-07 section 4
// used-by:      bin/ns-claims, hooks/stop-gate.mjs

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
