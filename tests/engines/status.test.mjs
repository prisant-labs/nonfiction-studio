// tests/engines/status.test.mjs
// what-it-is:   unit tests for hooks/lib/status-engine.mjs (the ns-status deterministic board)
// what-it-does: exercises the pure helper functions (parseGateFilename, selectNewestGateFilenames,
//               extractGateVerdict, extractDriftScore, deriveDriftThreshold, deriveChapterNumber,
//               deriveChapterTitle, isHighlighted, renderBoardMarkdown) directly against synthetic
//               objects, and computeStatusBoard (the one fs-touching function) against small temp
//               .studio/gate/ directories built per test. No process spawning here; CLI-level,
//               end-to-end behavior against the real golden sample book is covered separately in
//               tests/engines/status-cli.test.mjs.
// runner:       node --test tests/engines/status.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseGateFilename,
  selectNewestGateFilenames,
  readJsonSafe,
  extractGateVerdict,
  extractDriftScore,
  extractDriftThreshold,
  deriveChapterNumber,
  deriveChapterTitle,
  isHighlighted,
  computeStatusBoard,
  renderBoardMarkdown,
  DEMOTION_FALLBACK_STATUS,
  parseDecisionsLog,
  validateDecisionEntry,
  linksNameChapter,
  isEligibleForFinal,
} from '../../hooks/lib/status-engine.mjs';

// ---------------------------------------------------------------------------
// Helper: a temp directory containing only .studio/gate/, populated with the
// given { filename: reportObject } map. computeStatusBoard's only fs access
// is listing and reading this one directory.
// ---------------------------------------------------------------------------

const cleanupDirs = [];

function makeGateDir(reports = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ns-status-engine-'));
  cleanupDirs.push(dir);
  const gateDir = join(dir, '.studio', 'gate');
  mkdirSync(gateDir, { recursive: true });
  for (const [filename, report] of Object.entries(reports)) {
    writeFileSync(join(gateDir, filename), JSON.stringify(report), 'utf8');
  }
  return dir;
}

test.after(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- parseGateFilename -----------------------------------------------------

test('parseGateFilename: matches a per-chapter dot-form report', () => {
  const parsed = parseGateFilename('01-listening-before-speaking.20260810T091000Z.json');
  assert.deepEqual(parsed, { slug: '01-listening-before-speaking', timestamp: '20260810T091000Z' });
});

test('parseGateFilename: matches a whole-book report (slug "all")', () => {
  const parsed = parseGateFilename('all.20260810T091000Z.json');
  assert.deepEqual(parsed, { slug: 'all', timestamp: '20260810T091000Z' });
});

test('parseGateFilename: returns null for last-gate.json (only two dot-segments)', () => {
  assert.equal(parseGateFilename('last-gate.json'), null);
});

test('parseGateFilename: returns null for a non-.json file', () => {
  assert.equal(parseGateFilename('01-a.20260810T091000Z.txt'), null);
});

test('parseGateFilename: returns null when the timestamp segment is not the compact shape', () => {
  assert.equal(parseGateFilename('01-a.2026-08-10.json'), null);
  assert.equal(parseGateFilename('01-a.not-a-timestamp.json'), null);
});

test('parseGateFilename: returns null when there are more than three dot-segments', () => {
  assert.equal(parseGateFilename('01-a.extra.20260810T091000Z.json'), null);
});

test('parseGateFilename: a slug that is a prefix of another slug never false-matches', () => {
  // "01-a" must not match a file that actually belongs to slug "01-ab".
  const parsed = parseGateFilename('01-ab.20260810T091000Z.json');
  assert.equal(parsed.slug, '01-ab');
  assert.notEqual(parsed.slug, '01-a');
});

// ---- selectNewestGateFilenames ----------------------------------------------

test('selectNewestGateFilenames: picks the lexicographically-newest per-slug file regardless of input array order', () => {
  const filenames = [
    '01-a.20260101T000000Z.json',
    '01-a.20260815T000000Z.json',
    '01-a.20260601T000000Z.json',
  ];
  // Shuffle away from chronological order: readdirSync's order is filesystem-dependent
  // (not guaranteed lexicographic on every OS), so this proves the function does not
  // silently trust caller order the way a naive "take the last array element" would.
  const shuffled = [filenames[1], filenames[2], filenames[0]];
  const { perSlug } = selectNewestGateFilenames(shuffled);
  assert.equal(perSlug.get('01-a'), '01-a.20260815T000000Z.json');
});

test('selectNewestGateFilenames: tracks multiple slugs independently', () => {
  const filenames = [
    '01-a.20260101T000000Z.json',
    '02-b.20260601T000000Z.json',
    '01-a.20260815T000000Z.json',
    '02-b.20260101T000000Z.json',
  ];
  const { perSlug } = selectNewestGateFilenames(filenames);
  assert.equal(perSlug.get('01-a'), '01-a.20260815T000000Z.json');
  assert.equal(perSlug.get('02-b'), '02-b.20260601T000000Z.json');
});

test('selectNewestGateFilenames: picks the newest whole-book (all.<ts>.json) file separately from per-slug files', () => {
  const filenames = [
    '01-a.20260101T000000Z.json',
    'all.20260101T000000Z.json',
    'all.20260815T000000Z.json',
  ];
  const { perSlug, wholeBook } = selectNewestGateFilenames(filenames);
  assert.equal(wholeBook, 'all.20260815T000000Z.json');
  assert.equal(perSlug.has('all'), false, 'the "all" slug never lands in perSlug');
});

test('selectNewestGateFilenames: ignores non-matching files (for example last-gate.json)', () => {
  const filenames = ['last-gate.json', '.session-write-flag', '01-a.20260101T000000Z.json'];
  const { perSlug, wholeBook } = selectNewestGateFilenames(filenames);
  assert.equal(perSlug.get('01-a'), '01-a.20260101T000000Z.json');
  assert.equal(wholeBook, null);
});

test('selectNewestGateFilenames: empty listing returns an empty map and null wholeBook', () => {
  const { perSlug, wholeBook } = selectNewestGateFilenames([]);
  assert.equal(perSlug.size, 0);
  assert.equal(wholeBook, null);
});

// ---- readJsonSafe -----------------------------------------------------------

test('readJsonSafe: returns null (never throws) for a missing file', () => {
  const dir = makeGateDir();
  assert.equal(readJsonSafe(join(dir, 'does-not-exist.json')), null);
});

test('readJsonSafe: returns null (never throws) for malformed JSON', () => {
  const dir = makeGateDir();
  writeFileSync(join(dir, 'broken.json'), '{ not valid json', 'utf8');
  assert.equal(readJsonSafe(join(dir, 'broken.json')), null);
});

test('readJsonSafe: returns the parsed object for valid JSON', () => {
  const dir = makeGateDir({ 'r.json': { verdict: 'pass' } });
  assert.deepEqual(readJsonSafe(join(dir, '.studio', 'gate', 'r.json')), { verdict: 'pass' });
});

// ---- extractGateVerdict ------------------------------------------------------

test('extractGateVerdict: returns the top-level verdict string', () => {
  assert.equal(extractGateVerdict({ verdict: 'pass', checks: [] }), 'pass');
  assert.equal(extractGateVerdict({ verdict: 'block', checks: [] }), 'block');
});

test('extractGateVerdict: null when report is null, malformed, or verdict is absent/empty', () => {
  assert.equal(extractGateVerdict(null), null);
  assert.equal(extractGateVerdict({}), null);
  assert.equal(extractGateVerdict({ verdict: '' }), null);
  assert.equal(extractGateVerdict({ verdict: 42 }), null);
});

// ---- extractDriftScore (ADR-0012 voice verdict scope, Decision 2, PF-14: structured-field- ----
// first, prose-fallback-second) -------------------------------------------------------------

test('extractDriftScore: prefers the structured drift.statistic field when present (a number)', () => {
  const report = {
    checks: [{
      check: 'stylometry', verdict: 'pass',
      detail: 'book-scale drift statistic 1.42 within threshold 3.87',
      drift: { statistic: 1.42, threshold: 3.87 },
    }],
  };
  assert.equal(extractDriftScore(report), 1.42);
});

test('extractDriftScore: falls back to the legacy prose pattern ("drift score X.XX within threshold N") when drift.statistic is absent', () => {
  const report = {
    checks: [{ check: 'stylometry', verdict: 'pass', detail: 'drift score 10.86 within threshold 35' }],
  };
  assert.equal(extractDriftScore(report), 10.86);
});

test('extractDriftScore: prose fallback parses the "exceeds threshold" phrasing too', () => {
  const report = {
    checks: [{ check: 'stylometry', verdict: 'warn', detail: 'drift score 38.00 exceeds threshold 35; stylometry.drift-threshold' }],
  };
  assert.equal(extractDriftScore(report), 38);
});

test('extractDriftScore: prose fallback also parses the underscore-joined legacy phrasing ("drift_score N")', () => {
  const report = {
    checks: [{ check: 'stylometry', verdict: 'pass', detail: 'drift_score 0 is within threshold 35; chapter prose matches the baseline voice profile.' }],
  };
  assert.equal(extractDriftScore(report), 0);
});

test('extractDriftScore: a present but non-numeric drift.statistic falls back to the prose pattern, not a thrown error', () => {
  const report = {
    checks: [{
      check: 'stylometry', verdict: 'pass', detail: 'drift score 10.86 within threshold 35',
      drift: { statistic: 'not-a-number' },
    }],
  };
  assert.equal(extractDriftScore(report), 10.86);
});

test('extractDriftScore: null when the stylometry entry is absent', () => {
  const report = { checks: [{ check: 'claim_coverage', verdict: 'pass', detail: 'ok' }] };
  assert.equal(extractDriftScore(report), null);
});

test('extractDriftScore: null when the stylometry entry\'s own verdict is skip (even with a structured drift field)', () => {
  const report = {
    checks: [{ check: 'stylometry', verdict: 'skip', detail: 'check disabled in config', drift: { statistic: 1.42 } }],
  };
  assert.equal(extractDriftScore(report), null);
});

test('extractDriftScore: null (never throws) when neither drift.statistic nor a recognizable prose phrase is present', () => {
  const report = { checks: [{ check: 'stylometry', verdict: 'pass', detail: 'no numeric phrase here at all' }] };
  assert.doesNotThrow(() => extractDriftScore(report));
  assert.equal(extractDriftScore(report), null);
});

test('extractDriftScore: null (never throws) when report is null or checks is missing/malformed', () => {
  assert.equal(extractDriftScore(null), null);
  assert.equal(extractDriftScore({}), null);
  assert.equal(extractDriftScore({ checks: 'not-an-array' }), null);
});

// ---- extractDriftThreshold (ADR-0012 voice verdict scope, Decision 2, PF-14: per-report, -----
// no prose fallback) --------------------------------------------------------------------------

test('extractDriftThreshold: reads the structured drift.threshold field when present (a number)', () => {
  const report = {
    checks: [{ check: 'stylometry', verdict: 'pass', detail: 'irrelevant', drift: { statistic: 1.42, threshold: 3.87 } }],
  };
  assert.equal(extractDriftThreshold(report), 3.87);
});

test('extractDriftThreshold: null when drift is absent entirely (a report written before the structured field existed) -- NO prose fallback', () => {
  const report = {
    checks: [{ check: 'stylometry', verdict: 'pass', detail: 'drift score 10.86 within threshold 35' }],
  };
  assert.equal(extractDriftThreshold(report), null,
    'unlike extractDriftScore, there is no config-sourced or prose-parsed fallback for threshold');
});

test('extractDriftThreshold: null when drift.threshold is present but non-numeric', () => {
  const report = {
    checks: [{ check: 'stylometry', verdict: 'pass', detail: 'irrelevant', drift: { threshold: 'not-a-number' } }],
  };
  assert.equal(extractDriftThreshold(report), null);
});

test('extractDriftThreshold: null when the stylometry entry\'s own verdict is skip', () => {
  const report = {
    checks: [{ check: 'stylometry', verdict: 'skip', detail: 'irrelevant', drift: { threshold: 3.87 } }],
  };
  assert.equal(extractDriftThreshold(report), null);
});

test('extractDriftThreshold: null (never throws) when the stylometry entry or report is absent/malformed', () => {
  assert.equal(extractDriftThreshold(null), null);
  assert.equal(extractDriftThreshold({}), null);
  assert.equal(extractDriftThreshold({ checks: [{ check: 'claim_coverage', verdict: 'pass' }] }), null);
});

// ---- deriveChapterNumber -------------------------------------------------------

test('deriveChapterNumber: the two-digit prefix of a well-formed slug', () => {
  assert.equal(deriveChapterNumber('01-listening-before-speaking'), '01');
  assert.equal(deriveChapterNumber('12-the-end'), '12');
});

test('deriveChapterNumber: null for a malformed or missing slug (never guesses)', () => {
  assert.equal(deriveChapterNumber('chapter-one'), null);
  assert.equal(deriveChapterNumber(''), null);
  assert.equal(deriveChapterNumber(undefined), null);
  assert.equal(deriveChapterNumber(null), null);
});

// ---- deriveChapterTitle ----------------------------------------------------------

test('deriveChapterTitle: uses the title field when present', () => {
  assert.equal(deriveChapterTitle({ slug: '01-a', title: 'Listening Before Speaking' }), 'Listening Before Speaking');
});

test('deriveChapterTitle: derives from the slug when title is absent (prefix dropped, hyphens to spaces)', () => {
  assert.equal(deriveChapterTitle({ slug: '01-listening-before-speaking' }), 'listening before speaking');
});

test('deriveChapterTitle: derives from the slug when title is an empty string', () => {
  assert.equal(deriveChapterTitle({ slug: '02-finding-your-network', title: '' }), 'finding your network');
});

// ---- isHighlighted -----------------------------------------------------------------

test('isHighlighted: true when drift exceeds ITS OWN row\'s threshold', () => {
  assert.equal(isHighlighted({ drift: 41, threshold: 35, gate: 'warn' }), true);
});

test('isHighlighted: true when gate verdict is block, regardless of drift or threshold', () => {
  assert.equal(isHighlighted({ drift: 0, threshold: 35, gate: 'block' }), true);
  assert.equal(isHighlighted({ drift: null, threshold: null, gate: 'block' }), true);
});

test('isHighlighted: false when drift is at or under the threshold and gate is not block', () => {
  assert.equal(isHighlighted({ drift: 35, threshold: 35, gate: 'pass' }), false);
  assert.equal(isHighlighted({ drift: 10, threshold: 35, gate: 'warn' }), false);
});

test('isHighlighted: false (never throws) when drift is null and gate is not block', () => {
  assert.equal(isHighlighted({ drift: null, threshold: null, gate: null }), false);
  assert.equal(isHighlighted({ drift: null, threshold: 35, gate: 'pass' }), false);
});

test('isHighlighted: false (never throws) when threshold is null even though drift is a number and gate is not block', () => {
  // Since ADR-0012 (voice verdict scope, Decision 2), threshold is per-report; a report written
  // before the structured drift field existed carries no threshold at all (extractDriftThreshold
  // has no prose fallback), so a chapter with a drift NUMBER but no threshold can never be
  // highlighted on the drift condition alone -- the same defensive posture as a null drift.
  assert.equal(isHighlighted({ drift: 41, threshold: null, gate: 'warn' }), false);
});

// ---- computeStatusBoard (the one fs-touching function) ------------------------------

test('computeStatusBoard: a chapter with a matching gate report gets drift, threshold, gate, and a book-relative reportPath', () => {
  const root = makeGateDir({
    '01-a.20260810T091000Z.json': {
      version: 2, chapter: '01-a', ts: '2026-08-10T09:10:00Z', verdict: 'pass',
      checks: [{
        check: 'stylometry', verdict: 'pass',
        detail: 'worst chapter chapters/01-a.md: drift statistic 1.42 within threshold 3.87',
        evidence: [], next: null,
        drift: { regime: 'chapter', statistic: 1.42, threshold: 3.87, worst_marker: 'contraction_rate', worst_chapter: 'chapters/01-a.md', per_chapter: [], skipped: [] },
      }],
    },
  });
  const progress = {
    chapters: [{ slug: '01-a', title: 'Chapter A', status: 'drafted', word_count: 500, open_claim_count: 0 }],
    totals: { word_count: 500, open_claim_count: 0, chapters_final: 0, chapters_total: 2 },
  };
  const board = computeStatusBoard(root, progress, null);

  assert.equal(board.chapters.length, 1);
  const row = board.chapters[0];
  assert.equal(row.slug, '01-a');
  assert.equal(row.number, '01');
  assert.equal(row.title, 'Chapter A');
  assert.equal(row.status, 'drafted');
  assert.equal(row.wordCount, 500);
  assert.equal(row.openClaimCount, 0);
  assert.equal(row.drift, 1.42);
  assert.equal(row.threshold, 3.87);
  assert.equal(row.gate, 'pass');
  assert.equal(row.reportPath, '.studio/gate/01-a.20260810T091000Z.json');
  assert.equal(row.highlighted, false);
});

test('computeStatusBoard: a chapter whose report predates the structured drift field falls back to the prose pattern for drift, and gets a null threshold', () => {
  const root = makeGateDir({
    '01-a.20260810T091000Z.json': {
      version: 2, chapter: '01-a', ts: '2026-08-10T09:10:00Z', verdict: 'pass',
      checks: [{ check: 'stylometry', verdict: 'pass', detail: 'drift score 10.86 within threshold 35', evidence: [], next: null }],
    },
  });
  const progress = {
    chapters: [{ slug: '01-a', title: 'Chapter A', status: 'drafted', word_count: 500, open_claim_count: 0 }],
    totals: { word_count: 500, open_claim_count: 0, chapters_final: 0, chapters_total: 1 },
  };
  const board = computeStatusBoard(root, progress, null);
  const row = board.chapters[0];
  assert.equal(row.drift, 10.86, 'must fall back to prose parsing for a pre-structured-field report');
  assert.equal(row.threshold, null, 'threshold has no prose fallback');
  assert.equal(row.highlighted, false, 'a null threshold can never drive highlighting');
});

test('computeStatusBoard: a chapter with no matching gate report gets null drift, null threshold, null gate, null reportPath', () => {
  const root = makeGateDir({});
  const progress = {
    chapters: [{ slug: '02-b', title: 'Chapter B', status: 'drafted', word_count: 300, open_claim_count: 1 }],
    totals: { word_count: 300, open_claim_count: 1, chapters_final: 0, chapters_total: 2 },
  };
  const board = computeStatusBoard(root, progress, null);
  const row = board.chapters[0];
  assert.equal(row.drift, null);
  assert.equal(row.threshold, null);
  assert.equal(row.gate, null);
  assert.equal(row.reportPath, null);
  assert.equal(row.highlighted, false);
});

test('computeStatusBoard: a chapter whose drift exceeds ITS OWN report\'s threshold is highlighted', () => {
  const root = makeGateDir({
    '01-a.20260810T091000Z.json': {
      version: 2, chapter: '01-a', ts: '2026-08-10T09:10:00Z', verdict: 'warn',
      checks: [{
        check: 'stylometry', verdict: 'warn', detail: 'irrelevant', evidence: [], next: null,
        drift: { regime: 'chapter', statistic: 5.0, threshold: 3.0, worst_marker: 'm', worst_chapter: 'chapters/01-a.md', per_chapter: [], skipped: [] },
      }],
    },
  });
  const progress = {
    chapters: [{ slug: '01-a', title: 'Chapter A', status: 'drafted', word_count: 500, open_claim_count: 0 }],
    totals: { word_count: 500, open_claim_count: 0, chapters_final: 0, chapters_total: 1 },
  };
  const board = computeStatusBoard(root, progress, null);
  assert.equal(board.chapters[0].highlighted, true);
});

test('computeStatusBoard: missing .studio/gate/ directory entirely is not an error (every row degrades, not a throw)', () => {
  const bareDir = mkdtempSync(join(tmpdir(), 'ns-status-engine-bare-'));
  cleanupDirs.push(bareDir);
  const progress = {
    chapters: [{ slug: '01-a', status: 'empty', word_count: 0, open_claim_count: 0 }],
    totals: { word_count: 0, open_claim_count: 0, chapters_final: 0, chapters_total: 1 },
  };
  assert.doesNotThrow(() => computeStatusBoard(bareDir, progress, null));
  const board = computeStatusBoard(bareDir, progress, null);
  assert.equal(board.chapters[0].drift, null);
  assert.equal(board.chapters[0].gate, null);
});

// ---- GATE-SOURCE INVARIANT: computeStatusBoard never reads chapter.last_gate or ------
// chapter.drift_score from the progress argument, only the newest report under .studio/gate/.
// This is the same shape of trap as F-HK-05 (last_gate never written): progress.json's
// last_gate and drift_score are DELIBERATELY set to values that disagree with the real gate
// report on disk, for BOTH the verdict and the numeric drift score (not verdict alone), so an
// implementation that reads either progress.json field for either value would pass a naive
// test but fail this one.

test('GATE SOURCE: computeStatusBoard follows the newest .studio/gate/ report, never progress.json last_gate, drift_score, or config\'s retired drift_score_max', () => {
  const root = makeGateDir({
    '01-a.20260810T091000Z.json': {
      version: 2, chapter: '01-a', ts: '2026-08-10T09:10:00Z', verdict: 'pass',
      checks: [{
        check: 'stylometry', verdict: 'pass', detail: 'irrelevant', evidence: [], next: null,
        drift: { regime: 'chapter', statistic: 1.42, threshold: 3.87, worst_marker: 'm', worst_chapter: 'chapters/01-a.md', per_chapter: [], skipped: [] },
      }],
    },
  });
  const progress = {
    chapters: [{
      slug: '01-a', title: 'Chapter A', status: 'drafted', word_count: 500, open_claim_count: 0,
      // Deliberately disagreeing with the real report above, on BOTH fields:
      drift_score: 99.9,
      last_gate: { ts: '2026-01-01T00:00:00Z', verdict: 'block', report: '.studio/gate/stale.json' },
    }],
    totals: { word_count: 500, open_claim_count: 0, chapters_final: 0, chapters_total: 1 },
  };
  // config carries a retired thresholds.drift_score_max, deliberately disagreeing with the
  // report's own drift.threshold too -- this module reads NEITHER (ADR-0012 Decision 2).
  const board = computeStatusBoard(root, progress, { thresholds: { drift_score_max: 999 } });
  const row = board.chapters[0];
  assert.equal(row.gate, 'pass', 'gate verdict must come from the gate directory report, not progress.json last_gate ("block")');
  assert.equal(row.drift, 1.42, 'drift must come from the gate directory report, not progress.json drift_score (99.9)');
  assert.equal(row.threshold, 3.87, 'threshold must come from the report\'s own drift.threshold, not config\'s retired drift_score_max (999)');
});

// ---- totals and chaptersRemaining ---------------------------------------------------

test('computeStatusBoard: chaptersRemaining is chaptersTotal minus chaptersFinal when chaptersTotal is present', () => {
  const root = makeGateDir({});
  const progress = {
    chapters: [],
    totals: { word_count: 1055, open_claim_count: 0, chapters_final: 2, chapters_total: 6 },
  };
  const board = computeStatusBoard(root, progress, null);
  assert.equal(board.totals.chaptersTotal, 6);
  assert.equal(board.totals.chaptersFinal, 2);
  assert.equal(board.totals.chaptersRemaining, 4);
});

test('computeStatusBoard: chaptersRemaining is null when chaptersTotal is absent', () => {
  const root = makeGateDir({});
  const progress = { chapters: [], totals: { word_count: 0, open_claim_count: 0, chapters_final: 0 } };
  const board = computeStatusBoard(root, progress, null);
  assert.equal(board.totals.chaptersTotal, null);
  assert.equal(board.totals.chaptersRemaining, null);
});

test('computeStatusBoard: wholeBookGate reflects the newest all.<ts>.json report verdict', () => {
  const root = makeGateDir({
    'all.20260101T000000Z.json': { version: 2, chapter: 'all', ts: '2026-01-01T00:00:00Z', verdict: 'warn', checks: [] },
    'all.20260815T000000Z.json': { version: 2, chapter: 'all', ts: '2026-08-15T00:00:00Z', verdict: 'block', checks: [] },
  });
  const progress = { chapters: [], totals: { word_count: 0, open_claim_count: 0, chapters_final: 0 } };
  const board = computeStatusBoard(root, progress, null);
  assert.equal(board.wholeBookGate, 'block', 'the NEWEST all-report wins, not the oldest');
});

test('computeStatusBoard: wholeBookGate is null when no all.<ts>.json report exists', () => {
  const root = makeGateDir({});
  const progress = { chapters: [], totals: { word_count: 0, open_claim_count: 0, chapters_final: 0 } };
  const board = computeStatusBoard(root, progress, null);
  assert.equal(board.wholeBookGate, null);
});

// board.thresholds (a single board-wide config-sourced value) no longer exists: ADR-0012 (voice
// verdict scope, Decision 2) retired thresholds.drift_score_max, and each row's own threshold
// now comes from that SAME row's report (extractDriftThreshold, tested above, and
// "gets drift, threshold, gate" above at the computeStatusBoard level).

test('computeStatusBoard: two calls against the same unchanged inputs produce deep-equal results', () => {
  const root = makeGateDir({
    '01-a.20260810T091000Z.json': {
      version: 2, chapter: '01-a', ts: '2026-08-10T09:10:00Z', verdict: 'pass',
      checks: [{
        check: 'stylometry', verdict: 'pass', detail: 'irrelevant', evidence: [], next: null,
        drift: { regime: 'chapter', statistic: 1.42, threshold: 3.87, worst_marker: 'm', worst_chapter: 'chapters/01-a.md', per_chapter: [], skipped: [] },
      }],
    },
  });
  const progress = {
    chapters: [{ slug: '01-a', title: 'Chapter A', status: 'drafted', word_count: 500, open_claim_count: 0 }],
    totals: { word_count: 500, open_claim_count: 0, chapters_final: 0, chapters_total: 1 },
  };
  const first = computeStatusBoard(root, progress, null);
  const second = computeStatusBoard(root, progress, null);
  assert.deepEqual(first, second);
});

// ---- defensive: a chapter entry with no slug never renders "undefined" --------------

test('computeStatusBoard: a chapter entry with no slug degrades gracefully (never throws, never "undefined")', () => {
  const root = makeGateDir({});
  const progress = {
    chapters: [{ status: 'empty', word_count: 0, open_claim_count: 0 }],
    totals: { word_count: 0, open_claim_count: 0, chapters_final: 0 },
  };
  assert.doesNotThrow(() => computeStatusBoard(root, progress, null));
  const board = computeStatusBoard(root, progress, null);
  assert.equal(board.chapters[0].number, null);
  assert.equal(board.chapters[0].reportPath, null);
});

// ---- renderBoardMarkdown ---------------------------------------------------------------

function sampleBoard() {
  return {
    chapters: [
      {
        slug: '01-a', number: '01', title: 'Chapter A', status: 'drafted', wordCount: 528,
        openClaimCount: 0, drift: 1.42, threshold: 3.87, gate: 'pass',
        reportPath: '.studio/gate/01-a.20260810T091000Z.json', highlighted: false,
      },
      {
        slug: '02-b', number: '02', title: 'Chapter B', status: 'drafted', wordCount: 527,
        openClaimCount: 0, drift: null, threshold: null, gate: null, reportPath: null, highlighted: false,
      },
    ],
    totals: { wordCount: 1055, openClaimCount: 0, chaptersFinal: 0, chaptersTotal: 6, chaptersRemaining: 6 },
    wholeBookGate: null,
  };
}

test('renderBoardMarkdown: renders a Markdown table with one row per chapter plus a totals row', () => {
  const md = renderBoardMarkdown(sampleBoard());
  assert.match(md, /\|\s*#\s*\|\s*Title\s*\|\s*Status\s*\|\s*Words\s*\|\s*Drift\s*\|\s*Threshold\s*\|\s*Open Claims\s*\|\s*Gate\s*\|/);
  assert.match(md, /01.*Chapter A.*drafted.*528.*1\.42.*3\.87.*0.*pass/);
  assert.match(md, /02.*Chapter B.*drafted.*527.*-.*-.*0.*-/);
  assert.match(md, /Totals/);
  assert.match(md, /1055/);
});

test('renderBoardMarkdown: a highlighted row carries a "!" marker in the # cell', () => {
  const board = sampleBoard();
  board.chapters[1].highlighted = true;
  board.chapters[1].drift = 41;
  board.chapters[1].threshold = 35;
  board.chapters[1].gate = 'warn';
  const md = renderBoardMarkdown(board);
  const rowLine = md.split('\n').find((l) => l.includes('Chapter B'));
  assert.ok(rowLine.includes('!'), 'highlighted row must carry a "!" marker; got: ' + rowLine);
});

test('renderBoardMarkdown: each row\'s own threshold cell appears (no board-wide footer line since ADR-0012 retired the single config value)', () => {
  const md = renderBoardMarkdown(sampleBoard());
  assert.match(md, /3\.87/, 'row 1\'s own threshold must appear in its Threshold cell');
  assert.match(md, /6 chapter\(s\) remaining/);
  assert.ok(!md.includes('drift_score_max'),
    'the retired thresholds.drift_score_max footer line must be gone entirely; got:\n' + md);
});

test('renderBoardMarkdown: appends the whole-book gate annotation to the totals row when present', () => {
  const board = sampleBoard();
  board.wholeBookGate = 'warn';
  const md = renderBoardMarkdown(board);
  assert.match(md, /whole-book gate: warn/);
});

test('renderBoardMarkdown: never contains an absolute filesystem path', () => {
  const md = renderBoardMarkdown(sampleBoard());
  // A book-relative reportPath (".studio/gate/...") is fine; a drive letter or a leading
  // slash path segment is not, and would break cross-machine string-portable assertions.
  assert.ok(!/[A-Za-z]:[\\/]/.test(md), 'no Windows drive-letter path; got: ' + md);
});

test('renderBoardMarkdown: is a pure function of its input (two calls, same board, identical string)', () => {
  const board = sampleBoard();
  assert.equal(renderBoardMarkdown(board), renderBoardMarkdown(board));
});

// ---------------------------------------------------------------------------
// Promotion attestation (Task 5: the promotion ceremony and automatic
// demotion). parseDecisionsLog, validateDecisionEntry, linksNameChapter, and
// isEligibleForFinal are pure functions over already-read text, so they are
// unit tested here directly, the same way every other pure helper in this
// file is. hooks/post-tool-batch.mjs's use of these functions against a
// REAL subprocess run is covered separately in
// tests/hooks/post-tool-batch-promotion.test.mjs - this file never spawns a
// process.
// ---------------------------------------------------------------------------

// The two worked examples from docs/formats/decisions.md, reproduced
// VERBATIM (not paraphrased) so this suite proves the parser and validator
// against the same text a human reading that doc would write by hand.
const DECISIONS_DOC_HUMAN_ATTESTATION = [
  '### 2026-07-17 - human final pass attestation, chapter 03',
  '- actor: author',
  '- decision: Chapter 03 approved for gate after a full manual read.',
  '- rationale: Stylometry warned on drift but the technical section reads correctly for the audience.',
  '- links: .studio/gate/03-the-signal.20260717T154022Z.json, EV-0031 (survey figure)',
].join('\n');

const DECISIONS_DOC_EDITORIAL_OUTCOME = [
  '### 2026-07-17 - outline approved, chapter 04',
  '- actor: developmental-editor',
  '- decision: Outline accepted with minor structural adjustments.',
  '- rationale: Chapter flow matches the thesis arc established in chapter 01.',
  '- links: structure/04-the-archive.md',
].join('\n');

// ---- parseDecisionsLog ------------------------------------------------------

test('parseDecisionsLog: parses the format doc\'s human-attestation worked example verbatim', () => {
  const entries = parseDecisionsLog(DECISIONS_DOC_HUMAN_ATTESTATION);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    date: '2026-07-17',
    label: 'human final pass attestation, chapter 03',
    actor: 'author',
    decision: 'Chapter 03 approved for gate after a full manual read.',
    rationale: 'Stylometry warned on drift but the technical section reads correctly for the audience.',
    links: '.studio/gate/03-the-signal.20260717T154022Z.json, EV-0031 (survey figure)',
  });
});

test('parseDecisionsLog: parses the format doc\'s editorial-outcome worked example verbatim', () => {
  const entries = parseDecisionsLog(DECISIONS_DOC_EDITORIAL_OUTCOME);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].actor, 'developmental-editor');
  assert.equal(entries[0].links, 'structure/04-the-archive.md');
});

test('parseDecisionsLog: parses multiple entries in file order, ignoring preamble before the first heading', () => {
  const text = [
    '<!-- context/decisions.md',
    '     Append-only editorial and attestation log.',
    '-->',
    '',
    '# Decision Log',
    '',
    DECISIONS_DOC_HUMAN_ATTESTATION,
    '',
    DECISIONS_DOC_EDITORIAL_OUTCOME,
    '',
  ].join('\n');
  const entries = parseDecisionsLog(text);
  assert.equal(entries.length, 2, 'preamble produced no phantom entry');
  assert.equal(entries[0].label, 'human final pass attestation, chapter 03');
  assert.equal(entries[1].label, 'outline approved, chapter 04');
});

test('parseDecisionsLog: a field absent from an entry\'s bullet list comes back null, not undefined or thrown', () => {
  const text = '### 2026-08-15 - incomplete entry\n- actor: author\n- decision: Something decided.\n';
  const entries = parseDecisionsLog(text);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].rationale, null, 'missing rationale field is null');
  assert.equal(entries[0].links, null, 'missing optional links field is null');
});

test('parseDecisionsLog: an empty or non-string input yields zero entries, never throws', () => {
  assert.deepEqual(parseDecisionsLog(''), []);
  assert.deepEqual(parseDecisionsLog(null), []);
  assert.deepEqual(parseDecisionsLog(undefined), []);
});

// ---- validateDecisionEntry --------------------------------------------------

test('validateDecisionEntry: the format doc\'s human-attestation example is valid with nothing missing', () => {
  const entries = parseDecisionsLog(DECISIONS_DOC_HUMAN_ATTESTATION);
  assert.deepEqual(validateDecisionEntry(entries[0]), { valid: true, missing: [] });
});

test('validateDecisionEntry: an entry missing rationale is invalid and names the missing field', () => {
  const entries = parseDecisionsLog('### 2026-08-15 - incomplete entry\n- actor: author\n- decision: Something decided.\n');
  const result = validateDecisionEntry(entries[0]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.missing, ['rationale']);
});

test('validateDecisionEntry: links is optional; a blank links field does not affect validity', () => {
  const entries = parseDecisionsLog(
    '### 2026-08-15 - no links entry\n- actor: author\n- decision: Something decided.\n- rationale: Because.\n- links:\n'
  );
  assert.deepEqual(validateDecisionEntry(entries[0]), { valid: true, missing: [] });
});

// ---- linksNameChapter --------------------------------------------------------

test('linksNameChapter: matches a slug inside a chapters/ path token', () => {
  assert.equal(linksNameChapter('chapters/03-the-signal.md', '03-the-signal'), true);
});

test('linksNameChapter: matches a slug inside a gate-report-shaped token (the format doc\'s own example)', () => {
  assert.equal(
    linksNameChapter('.studio/gate/03-the-signal.20260717T154022Z.json, EV-0031 (survey figure)', '03-the-signal'),
    true
  );
});

test('linksNameChapter: does not false-positive on a longer, different slug sharing a prefix', () => {
  assert.equal(linksNameChapter('chapters/03-the-signal-appendix.md', '03-the-signal'), false);
});

test('linksNameChapter: returns false for blank, null, or non-string links', () => {
  assert.equal(linksNameChapter('', '03-the-signal'), false);
  assert.equal(linksNameChapter(null, '03-the-signal'), false);
  assert.equal(linksNameChapter(undefined, '03-the-signal'), false);
});

test('linksNameChapter: returns false when slug itself is not schema-shaped (defensive, never guesses)', () => {
  assert.equal(linksNameChapter('chapters/not-a-slug.md', 'not-a-slug'), false);
});

// ---- isEligibleForFinal (THE SHARED ELIGIBILITY PREDICATE) -----------------

test('isEligibleForFinal: the format doc\'s human-attestation example makes its chapter eligible', () => {
  const entries = parseDecisionsLog(DECISIONS_DOC_HUMAN_ATTESTATION);
  assert.equal(isEligibleForFinal('03-the-signal', entries), true);
});

test('isEligibleForFinal: a chapter with no matching entry at all is not eligible', () => {
  const entries = parseDecisionsLog(DECISIONS_DOC_HUMAN_ATTESTATION);
  assert.equal(isEligibleForFinal('02-finding-your-network', entries), false);
});

test('isEligibleForFinal: a roster-slug actor (not literal "author") never confers eligibility', () => {
  // The editorial-outcome example names chapter 04 in its links but is attested
  // by a roster slug (developmental-editor), not the human author - it records
  // an agent's editorial judgment, not the human final-pass sign-off.
  const entries = parseDecisionsLog(DECISIONS_DOC_EDITORIAL_OUTCOME);
  assert.equal(isEligibleForFinal('04-the-archive', entries), false);
});

test('isEligibleForFinal: a structurally invalid entry (missing rationale) does not confer eligibility even with actor: author and a matching link', () => {
  const entries = parseDecisionsLog(
    '### 2026-08-15 - incomplete attestation\n- actor: author\n- decision: Approved.\n- links: chapters/01-listening-before-speaking.md\n'
  );
  assert.equal(isEligibleForFinal('01-listening-before-speaking', entries), false);
});

test('isEligibleForFinal: a non-array entries argument is not eligible (defensive)', () => {
  assert.equal(isEligibleForFinal('01-listening-before-speaking', null), false);
  assert.equal(isEligibleForFinal('01-listening-before-speaking', undefined), false);
});

// ---- DEMOTION_FALLBACK_STATUS -----------------------------------------------

test('DEMOTION_FALLBACK_STATUS is "revised", a schema-valid status distinct from "final" and "gated"', () => {
  assert.equal(DEMOTION_FALLBACK_STATUS, 'revised');
});
