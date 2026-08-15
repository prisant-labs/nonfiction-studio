// what-it-is:   the ns-status engine (deterministic project chapter board and completion numbers)
// what-it-does: computes a per-chapter board and whole-book totals from progress.json's chapters
//               and totals, config.json's drift threshold, and the newest gate report per chapter
//               slug under .studio/gate/; renders the result as JSON-ready data or a Markdown board
// why:          the status-dashboard skill today asks the language model to list a directory, parse
//               filenames, open reports, and read numbers out of prose by eye, with nothing
//               asserting it parsed correctly the same way twice; this module is the deterministic
//               computation a later task points that skill at, following the same CLI-over-engine-
//               module pattern the other seven CLIs already use (ADR-0009 (apparatus CLI),
//               growth-policy criterion 1: correctness here is a byte-for-byte, machine-checkable
//               property a failing test can be written against before the feature exists)
// used-by:      bin/ns-status
//
// GATE-SOURCE INVARIANT: gate verdict and drift score for a chapter come ONLY from the newest
// report file per chapter slug under .studio/gate/, never from progress.json's per-chapter
// `last_gate` field, and never from progress.json's per-chapter `drift_score` field either. Both
// fields are read by no function in this module. `last_gate` stays null in every v1 writer by
// design (finding F-HK-05, resolved by re-specification, not implementation); a hand-authored
// fixture may populate it for one chapter as sample content, which is exactly the trap a naive
// implementation would pass by accident. `drift_score` is a separate, hook-maintained convenience
// field that this board never treats as authoritative either, for the same reason. See
// computeStatusBoard below, whose only per-chapter fs read is a .studio/gate/ report file.
//
// DETERMINISM INVARIANT: no function in this module stamps a generation timestamp, reads the
// system clock, or formats a number with a locale-aware method (no toLocaleString, no
// Intl.NumberFormat); every path field emitted is book-root-relative, never an absolute
// filesystem path. This follows hooks/lib/statusline-engine.mjs's own stated convention, for
// exactly the same reason: this repo's CI runs both an Ubuntu and a Windows leg, and two runs
// against the same unchanged project must produce byte-identical output on either.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Matches skills/status-dashboard/SKILL.md's documented default (35, applied when
// .studio/config.json or its thresholds.drift_score_max field is absent).
export const DEFAULT_DRIFT_THRESHOLD = 35;

/**
 * Parses a .studio/gate/ filename against the two significant patterns documented in
 * docs/formats/gate-report.md ("Filename pattern"):
 *   per-chapter: <slug>.<YYYYMMDDTHHMMSSZ>.json
 *   whole-book:  all.<YYYYMMDDTHHMMSSZ>.json (slug is the literal string "all")
 * Returns null for anything else - for example last-gate.json (only two dot-separated
 * segments, no timestamp segment) or .session-write-flag. Deliberately strict: a filename
 * must split into EXACTLY three dot-separated segments, the last must be "json", and the
 * middle must match the compact YYYYMMDDTHHMMSSZ shape hooks/lib/gate-engine.mjs's own
 * formatTimestamp produces. This guards against a chapter slug that is a prefix of another
 * slug (for example "01-a" against a file actually named "01-ab.<ts>.json") ever
 * false-matching, since a chapter slug never contains a "." (the schema's own slug pattern,
 * templates/book-scaffold/.studio/progress.schema.json, permits only digits, lowercase
 * letters, and hyphens).
 *
 * @param {string} filename
 * @returns {{slug: string, timestamp: string}|null}
 */
export function parseGateFilename(filename) {
  const parts = filename.split('.');
  if (parts.length !== 3) return null;
  const [slug, timestamp, ext] = parts;
  if (ext !== 'json') return null;
  if (!/^\d{8}T\d{6}Z$/.test(timestamp)) return null;
  if (!slug) return null;
  return { slug, timestamp };
}

/**
 * Selects the newest report filename per chapter slug, plus the newest whole-book
 * (all.<ts>.json) report filename, from a .studio/gate/ directory listing.
 *
 * Sorts the ENTIRE input array lexicographically before grouping, rather than trusting the
 * caller's array order: Node's readdirSync order is filesystem- and platform-dependent, not
 * guaranteed lexicographic on every OS, and this repo's CI runs both Ubuntu and Windows, so
 * "newest" must never depend on directory-enumeration order. Because every filename for a
 * given slug shares that slug as a literal prefix, sorting the full filename string also sorts
 * each slug's own files by timestamp (the shared prefix contributes nothing to the
 * comparison), so a single global sort is sufficient - the last filename encountered per slug,
 * in sorted order, is the newest. Lexicographic order over the compact YYYYMMDDTHHMMSSZ shape
 * equals chronological order by construction, the same equivalence
 * hooks/lib/gate-engine.mjs's own pruneGateReports and skills/status-dashboard/SKILL.md both
 * already rely on.
 *
 * @param {string[]} filenames - a .studio/gate/ directory listing, any order
 * @returns {{perSlug: Map<string,string>, wholeBook: string|null}}
 */
export function selectNewestGateFilenames(filenames) {
  const bySlug = new Map();
  const wholeBookCandidates = [];

  for (const filename of [...filenames].sort()) {
    const parsed = parseGateFilename(filename);
    if (!parsed) continue;
    if (parsed.slug === 'all') {
      wholeBookCandidates.push(filename);
      continue;
    }
    if (!bySlug.has(parsed.slug)) bySlug.set(parsed.slug, []);
    bySlug.get(parsed.slug).push(filename);
  }

  const perSlug = new Map();
  for (const [slug, files] of bySlug) {
    perSlug.set(slug, files[files.length - 1]);
  }

  const wholeBook = wholeBookCandidates.length > 0
    ? wholeBookCandidates[wholeBookCandidates.length - 1]
    : null;

  return { perSlug, wholeBook };
}

/**
 * Reads and JSON-parses a file, returning null on ANY failure (missing file, unreadable,
 * malformed JSON) instead of throwing. Used for individual .studio/gate/ report files: one
 * corrupt or unreadable report degrades that one chapter's drift/gate cells to null, rather
 * than failing the whole board - mirrors hooks/lib/statusline-engine.mjs's readJsonSafe, which
 * exists for the same reason over a different optional file.
 *
 * @param {string} absPath
 * @returns {object|null}
 */
export function readJsonSafe(absPath) {
  try {
    return JSON.parse(readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Extracts the top-level `verdict` from a parsed gate report object (docs/formats/gate-report.md).
 * Returns null when the report is null/malformed or carries no non-empty string verdict.
 *
 * @param {object|null} report
 * @returns {string|null}
 */
export function extractGateVerdict(report) {
  if (!report || typeof report.verdict !== 'string' || report.verdict === '') return null;
  return report.verdict;
}

// Matches the live hooks/lib/gate-engine.mjs detail-string shape ("drift score 10.86 within
// threshold 35" / "... exceeds threshold 35; stylometry.drift-threshold") and the
// underscore-joined shape docs/formats/gate-report.md's own worked example uses
// ("drift_score 38 exceeds threshold 35"), so a wording gap between the engine and its
// documentation does not silently stop this function from parsing a real report either way.
const DRIFT_SCORE_PATTERN = /drift[ _]score\s+(-?\d+(?:\.\d+)?)/i;

/**
 * Extracts the numeric drift score from a parsed gate report's `stylometry` check entry.
 * Returns null when: the report is null/malformed, no `checks[]` entry has `check ===
 * "stylometry"`, that entry's own verdict is "skip" (skills/status-dashboard/SKILL.md Step 2:
 * "If the stylometry entry is absent or its verdict is skip, the Drift cell is '-'"), or its
 * `detail` string carries no recognizable "drift score N" phrase. Never throws: an
 * unparseable detail string degrades to null (an honest "no drift score available" cell)
 * rather than failing the whole board over one chapter's report.
 *
 * @param {object|null} report
 * @returns {number|null}
 */
export function extractDriftScore(report) {
  if (!report || !Array.isArray(report.checks)) return null;
  const styloCheck = report.checks.find((c) => c && c.check === 'stylometry');
  if (!styloCheck || styloCheck.verdict === 'skip') return null;
  if (typeof styloCheck.detail !== 'string') return null;
  const match = DRIFT_SCORE_PATTERN.exec(styloCheck.detail);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Reads config.json's `thresholds.drift_score_max`. Returns the configured value when it is a
 * finite number; otherwise DEFAULT_DRIFT_THRESHOLD with isDefault: true, matching the default
 * skills/status-dashboard/SKILL.md documents. A present-but-malformed value (wrong type,
 * non-finite) is treated the same as an absent one for this purpose. An unreadable
 * config.json itself never reaches this function: findBookRoot's loadBible already throws a
 * BibleError on a corrupt config.json, which the CLI surfaces as an exit-2 operational error
 * before computeStatusBoard is ever called.
 *
 * @param {object|null} config
 * @returns {{value: number, isDefault: boolean}}
 */
export function deriveDriftThreshold(config) {
  const raw = config && config.thresholds && config.thresholds.drift_score_max;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { value: raw, isDefault: false };
  }
  return { value: DEFAULT_DRIFT_THRESHOLD, isDefault: true };
}

/**
 * The two-digit numeric prefix of a chapter slug (for example "01" from
 * "01-listening-before-speaking"), matching the schema's own slug pattern
 * (templates/book-scaffold/.studio/progress.schema.json: ^[0-9]{2}-[a-z0-9-]+$). Returns null
 * for a slug that does not start with that shape, rather than guessing: schema-required is not
 * schema-guaranteed against a hand-edited progress.json (the same defensive posture
 * hooks/lib/statusline-engine.mjs's formatChapterSegment takes against the same file).
 *
 * @param {string} slug
 * @returns {string|null}
 */
export function deriveChapterNumber(slug) {
  if (typeof slug !== 'string') return null;
  const match = /^(\d{2})-/.exec(slug);
  return match ? match[1] : null;
}

/**
 * The Title cell: the chapter's own `title` field when present and non-empty, else derived
 * from the slug by dropping the two-digit numeric prefix and replacing hyphens with spaces
 * (for example "listening before speaking" from "01-listening-before-speaking") - matching
 * skills/status-dashboard/SKILL.md Step 4's documented derivation exactly.
 *
 * @param {object} chapter - a progress.json chapters[] entry
 * @returns {string}
 */
export function deriveChapterTitle(chapter) {
  if (typeof chapter.title === 'string' && chapter.title !== '') return chapter.title;
  const slug = typeof chapter.slug === 'string' ? chapter.slug : '';
  return slug.replace(/^\d{2}-/, '').split('-').join(' ');
}

/**
 * A chapter row is highlighted when its drift score exceeds the effective threshold, or its
 * gate verdict is "block" - the same two conditions skills/status-dashboard/SKILL.md Step 5
 * already applies. A chapter with no drift score (null) can never be highlighted on the drift
 * condition alone.
 *
 * @param {{drift: number|null, gate: string|null}} row
 * @param {number} thresholdValue
 * @returns {boolean}
 */
export function isHighlighted(row, thresholdValue) {
  const driftExceeds = typeof row.drift === 'number' && row.drift > thresholdValue;
  const blocked = row.gate === 'block';
  return driftExceeds || blocked;
}

/**
 * Computes the full chapter board: one row per progress.json chapters[] entry (array order
 * preserved), whole-book totals, the newest whole-book gate annotation if any all.<ts>.json
 * report exists, and the effective drift threshold. The sole fs access here beyond what the
 * caller already performed to obtain `progress` and `config` is listing and reading
 * .studio/gate/; a missing or empty gate directory is not an error
 * (skills/status-dashboard/SKILL.md: "not a halt condition") - it simply leaves every
 * chapter's drift and gate null.
 *
 * @param {string} root - absolute book root (used only to locate .studio/gate/)
 * @param {object} progress - already-parsed progress.json (hooks/lib/bible.mjs readProgress)
 * @param {object|null} config - already-parsed config.json, or null (findBookRoot's loadBible)
 * @returns {{
 *   chapters: Array<{slug: string, number: string|null, title: string, status: string|null,
 *                     wordCount: number, openClaimCount: number, drift: number|null,
 *                     gate: string|null, reportPath: string|null, highlighted: boolean}>,
 *   totals: {wordCount: number, openClaimCount: number, chaptersFinal: number,
 *            chaptersTotal: number|null, chaptersRemaining: number|null},
 *   wholeBookGate: string|null,
 *   thresholds: {driftScoreMax: number, driftScoreMaxIsDefault: boolean},
 * }}
 */
export function computeStatusBoard(root, progress, config) {
  const gateDir = join(root, '.studio', 'gate');
  let filenames = [];
  if (existsSync(gateDir)) {
    try {
      filenames = readdirSync(gateDir);
    } catch {
      filenames = [];
    }
  }
  const { perSlug, wholeBook } = selectNewestGateFilenames(filenames);

  const { value: driftScoreMax, isDefault: driftScoreMaxIsDefault } = deriveDriftThreshold(config);

  const chaptersRaw = Array.isArray(progress.chapters) ? progress.chapters : [];
  const chapters = chaptersRaw.map((chapter) => {
    const reportFilename = perSlug.get(chapter.slug) || null;
    const report = reportFilename ? readJsonSafe(join(gateDir, reportFilename)) : null;
    const reportPath = reportFilename
      ? relative(root, join(gateDir, reportFilename)).split('\\').join('/')
      : null;

    const row = {
      slug: typeof chapter.slug === 'string' ? chapter.slug : null,
      number: deriveChapterNumber(chapter.slug),
      title: deriveChapterTitle(chapter),
      status: typeof chapter.status === 'string' ? chapter.status : null,
      wordCount: typeof chapter.word_count === 'number' ? chapter.word_count : 0,
      openClaimCount: typeof chapter.open_claim_count === 'number' ? chapter.open_claim_count : 0,
      drift: extractDriftScore(report),
      gate: extractGateVerdict(report),
      reportPath,
    };
    row.highlighted = isHighlighted(row, driftScoreMax);
    return row;
  });

  const totalsRaw = (progress.totals && typeof progress.totals === 'object') ? progress.totals : {};
  const chaptersTotal = typeof totalsRaw.chapters_total === 'number' ? totalsRaw.chapters_total : null;
  const chaptersFinal = typeof totalsRaw.chapters_final === 'number' ? totalsRaw.chapters_final : 0;

  const totals = {
    wordCount: typeof totalsRaw.word_count === 'number' ? totalsRaw.word_count : 0,
    openClaimCount: typeof totalsRaw.open_claim_count === 'number' ? totalsRaw.open_claim_count : 0,
    chaptersFinal,
    chaptersTotal,
    chaptersRemaining: chaptersTotal === null ? null : chaptersTotal - chaptersFinal,
  };

  let wholeBookGate = null;
  if (wholeBook) {
    wholeBookGate = extractGateVerdict(readJsonSafe(join(gateDir, wholeBook)));
  }

  return {
    chapters,
    totals,
    wholeBookGate,
    thresholds: { driftScoreMax, driftScoreMaxIsDefault },
  };
}

/**
 * Renders a computeStatusBoard() result as a Markdown table (columns: #, Title, Status,
 * Words, Drift, Open Claims, Gate - matching skills/status-dashboard/SKILL.md Step 4's
 * established column set) plus a short footer: the drift threshold and its source, and the
 * chapters-remaining-to-final count when progress.json's totals carry a chapters_total. A
 * highlighted row (see isHighlighted) carries a leading "!" in its # cell, the same convention
 * skills/status-dashboard/SKILL.md already uses. Deterministic: no timestamp, no
 * locale-formatted number (plain string concatenation only - JavaScript's default
 * Number-to-string conversion is locale-independent, unlike toLocaleString/Intl.NumberFormat),
 * no absolute path (reportPath, when present, is always book-root-relative).
 *
 * @param {ReturnType<typeof computeStatusBoard>} board
 * @returns {string}
 */
export function renderBoardMarkdown(board) {
  const lines = [];
  lines.push('| # | Title | Status | Words | Drift | Open Claims | Gate |');
  lines.push('|---|---|---|---|---|---|---|');

  for (const row of board.chapters) {
    const numCell = (row.highlighted ? '! ' : '') + (row.number || '');
    const drift = typeof row.drift === 'number' ? String(row.drift) : '-';
    const gate = row.gate || '-';
    lines.push(
      '| ' + numCell + ' | ' + row.title + ' | ' + (row.status || '-') + ' | ' + row.wordCount +
      ' | ' + drift + ' | ' + row.openClaimCount + ' | ' + gate + ' |'
    );
  }

  const chaptersFinalCell = board.totals.chaptersTotal !== null
    ? board.totals.chaptersFinal + ' of ' + board.totals.chaptersTotal + ' final'
    : board.totals.chaptersFinal + ' final';
  const wholeBookAnnotation = board.wholeBookGate ? ' (whole-book gate: ' + board.wholeBookGate + ')' : '';
  lines.push(
    '| **Totals** | | | **' + board.totals.wordCount + '** | | **' + board.totals.openClaimCount +
    '** | **' + chaptersFinalCell + '**' + wholeBookAnnotation + ' |'
  );

  lines.push('');
  const thresholdSource = board.thresholds.driftScoreMaxIsDefault
    ? ' (default applied; field absent from .studio/config.json)'
    : ' (from .studio/config.json)';
  lines.push(
    'Drift threshold: thresholds.drift_score_max = ' + board.thresholds.driftScoreMax + thresholdSource + '.'
  );

  if (board.totals.chaptersRemaining !== null) {
    lines.push(board.totals.chaptersRemaining + ' chapter(s) remaining to final.');
  }

  return lines.join('\n');
}
