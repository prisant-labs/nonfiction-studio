// what-it-is:   the ns-status engine (deterministic project chapter board and completion numbers)
// what-it-does: computes a per-chapter board and whole-book totals from progress.json's chapters
//               and totals, config.json's drift threshold, and the newest gate report per chapter
//               slug under .studio/gate/; renders the result as JSON-ready data or a Markdown board
// why:          this module is the deterministic computation nfs-status-dashboard's skill body
//               narrates rather than computes: the skill no longer asks the language model to
//               list a directory, parse filenames, open reports, and read numbers out of prose
//               by eye (nothing asserted correctness the same way twice under that approach); it
//               invokes bin/ns-status and renders this module's JSON output directly, following
//               the same CLI-over-engine-module pattern the other seven CLIs already use
//               (ADR-0009 (apparatus CLI), growth-policy criterion 1: correctness here is a
//               byte-for-byte, machine-checkable property a failing test can be written against
//               before the feature exists)
// used-by:      bin/ns-status, and hooks/post-tool-batch.mjs, which imports
//               DEMOTION_FALLBACK_STATUS, parseDecisionsLog, and isEligibleForFinal directly
//
// GATE-SOURCE INVARIANT: gate verdict and drift score for a chapter come ONLY from the newest
// report file per chapter slug under .studio/gate/, never from progress.json's per-chapter
// `last_gate` field, and never from progress.json's per-chapter `drift_score` field either. Both
// fields are read by no function in this module. `last_gate` stays null in every v1 writer by
// design (finding F-HK-05 (last_gate never written), resolved by re-specification, not
// implementation); a hand-authored fixture may populate it for one chapter as sample content,
// which is exactly the trap a naive implementation would pass by accident. `drift_score` is a
// separate, hook-maintained convenience field that this board never treats as authoritative
// either, for the same reason. See computeStatusBoard below, whose only per-chapter fs read is
// a .studio/gate/ report file.
//
// DETERMINISM INVARIANT: no function in this module stamps a generation timestamp, reads the
// system clock, or formats a number with a locale-aware method (no toLocaleString, no
// Intl.NumberFormat); every path field emitted is book-root-relative, never an absolute
// filesystem path. This follows hooks/lib/statusline-engine.mjs's own stated convention, for
// exactly the same reason: this repo's CI runs both an Ubuntu and a Windows leg, and two runs
// against the same unchanged project must produce byte-identical output on either.
//
// PROMOTION ATTESTATION (the promotion ceremony and automatic demotion): the exports below this
// point (DEMOTION_FALLBACK_STATUS, parseDecisionsLog, validateDecisionEntry, linksNameChapter,
// isEligibleForFinal) are the ONE implementation of "is this chapter eligible for the terminal
// `final` status." hooks/post-tool-batch.mjs - the sole writer of progress.json per D-06
// (single-writer state discipline) - imports and calls isEligibleForFinal rather than
// re-deriving eligibility, so the hook (which enforces it) and this module (which reports the
// board) cannot drift on what "eligible" means. This mirrors why foldForCompare has exactly one
// implementation (hooks/lib/agent-identity.mjs) instead of the three this project once carried.
// All five are pure: they touch no filesystem. The hook itself reads and parses
// context/decisions.md and passes the result in.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DEFAULT_DRIFT_SCORE_MAX } from './stylometry-engine.mjs';

// This engine's own built-in default, applied when .studio/config.json or its
// thresholds.drift_score_max field is absent. skills/nfs-status-dashboard/SKILL.md deliberately
// documents no threshold number of its own; it narrates whichever value and isDefault flag this
// module reports. Re-exported under this module's own name (rather than importing
// DEFAULT_DRIFT_SCORE_MAX directly at call sites) so this module keeps its own stable public
// name while hooks/lib/stylometry-engine.mjs stays the single source of truth for the number
// itself.
export const DEFAULT_DRIFT_THRESHOLD = DEFAULT_DRIFT_SCORE_MAX;

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
 * hooks/lib/gate-engine.mjs's own pruneGateReports also relies on. skills/nfs-status-dashboard/
 * SKILL.md no longer restates this rule itself; it narrates whatever this module already
 * selected.
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
// threshold 25" / "... exceeds threshold 25; stylometry.drift-threshold") and the
// underscore-joined shape docs/formats/gate-report.md's own worked example uses
// ("drift_score 38 exceeds threshold 25"), so a wording gap between the engine and its
// documentation does not silently stop this function from parsing a real report either way.
const DRIFT_SCORE_PATTERN = /drift[ _]score\s+(-?\d+(?:\.\d+)?)/i;

/**
 * Extracts the numeric drift score from a parsed gate report's `stylometry` check entry.
 * Returns null when: the report is null/malformed, no `checks[]` entry has `check ===
 * "stylometry"`, that entry's own verdict is "skip" (the same "Drift cell is -" rule
 * bin/ns-status's JSON reports and skills/nfs-status-dashboard/SKILL.md narrates verbatim, rather
 * than re-deriving), or its `detail` string carries no recognizable "drift score N" phrase.
 * Never throws: an
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
 * finite number; otherwise DEFAULT_DRIFT_THRESHOLD with isDefault: true. skills/nfs-status-dashboard/
 * SKILL.md documents no default of its own; it narrates whichever value and isDefault flag this
 * function returns. A present-but-malformed value (wrong type,
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
 * (for example "listening before speaking" from "01-listening-before-speaking").
 * skills/nfs-status-dashboard/SKILL.md documents no derivation of its own; it reads whatever this
 * function already produced in bin/ns-status's JSON `title` field.
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
 * gate verdict is "block" - the same two conditions this engine alone applies.
 * skills/nfs-status-dashboard/SKILL.md reads the resulting `highlighted` field verbatim rather than
 * re-deriving them. A chapter with no drift score (null) can never be highlighted on the drift
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
 * (skills/nfs-status-dashboard/SKILL.md: "not a halt condition") - it simply leaves every
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
 * Words, Drift, Open Claims, Gate - the same column set skills/nfs-status-dashboard/SKILL.md's
 * JSON-driven render also uses) plus a short footer: the drift threshold and its source, and the
 * chapters-remaining-to-final count when progress.json's totals carry a chapters_total. A
 * highlighted row (see isHighlighted) carries a leading "!" in its # cell; skills/nfs-status-dashboard/
 * SKILL.md's own render applies that same leading "!" by reading the `highlighted` field
 * directly, not by re-deriving it. Deterministic: no timestamp, no
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

// ---------------------------------------------------------------------------
// PROMOTION ATTESTATION
//
// docs/formats/decisions.md is the normative grammar for context/decisions.md:
// append-only, heading `### YYYY-MM-DD - <label>`, body fields `actor` (either
// the literal string "author" or a roster slug), `decision`, `rationale`, and
// optional `links`. The functions below are the ONE parser and the ONE
// eligibility predicate for that grammar (see the module header above for why
// they live here). All four are pure - no filesystem access - so they are
// unit tested directly against synthetic and doc-verbatim text, independent
// of any hook.
// ---------------------------------------------------------------------------

// The status a chapter falls back to when it is found `final` but ineligible
// (hooks/post-tool-batch.mjs is the only writer that ever assigns this). NOT
// `gated`: `gated` asserts a gate run passed against the CURRENT content,
// which is never true for a chapter whose eligibility just failed - either it
// was just edited and has not been re-gated, or its `final` status was never
// legitimate to begin with. `revised` is accurate in both cases: this
// project's own chapter-lifecycle prose reads `revised` as "after a revise
// pass," exactly the state a demoted chapter is in, and it asserts nothing
// about a gate outcome the hook cannot vouch for.
export const DEMOTION_FALLBACK_STATUS = 'revised';

const DECISION_HEADING_RE = /^###\s+(\d{4}-\d{2}-\d{2})\s+-\s+(.+?)\s*$/;
const DECISION_FIELD_RE = /^-\s*([a-zA-Z]+):\s?(.*)$/;
const DECISION_FIELD_NAMES = new Set(['actor', 'decision', 'rationale', 'links']);
const REQUIRED_DECISION_FIELDS = ['actor', 'decision', 'rationale'];

/**
 * Parses context/decisions.md text into an array of entries in file order:
 * { date, label, actor, decision, rationale, links }. A field absent from an
 * entry's bullet list comes back as null (validateDecisionEntry below is what
 * turns that into a finding); links is the one field the grammar itself
 * allows to be genuinely absent or blank. Content before the first heading
 * (the HTML comment, the "# Decision Log" title) is ignored. Never throws on
 * malformed content - at worst, an unparseable file yields zero entries,
 * which isEligibleForFinal correctly reads as "no attestation exists" rather
 * than crashing its caller.
 *
 * @param {string} text - raw context/decisions.md content
 * @returns {Array<{date: string, label: string, actor: string|null,
 *                   decision: string|null, rationale: string|null, links: string|null}>}
 */
export function parseDecisionsLog(text) {
  const entries = [];
  if (typeof text !== 'string') return entries;

  let current = null;
  for (const rawLine of text.split('\n')) {
    const headingMatch = DECISION_HEADING_RE.exec(rawLine);
    if (headingMatch) {
      if (current) entries.push(current);
      current = {
        date: headingMatch[1],
        label: headingMatch[2],
        actor: null,
        decision: null,
        rationale: null,
        links: null,
      };
      continue;
    }
    if (!current) continue; // preamble before the first heading
    const fieldMatch = DECISION_FIELD_RE.exec(rawLine);
    if (!fieldMatch) continue;
    const key = fieldMatch[1].toLowerCase();
    if (!DECISION_FIELD_NAMES.has(key)) continue;
    current[key] = fieldMatch[2].trim();
  }
  if (current) entries.push(current);
  return entries;
}

/**
 * Validates one parsed entry against docs/formats/decisions.md's required-
 * field rule: `actor`, `decision`, and `rationale` are required and must be
 * non-empty strings; `links` is optional and may be blank or absent. This is
 * the field-presence validator for the decision-log grammar.
 *
 * @param {{actor: *, decision: *, rationale: *}} entry
 * @returns {{valid: boolean, missing: string[]}}
 */
export function validateDecisionEntry(entry) {
  const missing = [];
  for (const field of REQUIRED_DECISION_FIELDS) {
    const val = entry ? entry[field] : undefined;
    if (typeof val !== 'string' || val === '') missing.push(field);
  }
  return { valid: missing.length === 0, missing };
}

// A chapter slug, matching the schema's own pattern exactly
// (templates/book-scaffold/.studio/progress.schema.json: ^[0-9]{2}-[a-z0-9-]+$).
const CHAPTER_SLUG_RE = /^[0-9]{2}-[a-z0-9-]+$/;

/**
 * Whether a decision entry's free-text `links` field names the given chapter
 * slug. Matches the slug as a whole token, bounded on both sides by either a
 * string edge or a character outside the slug alphabet (digits, lowercase
 * letters, hyphen) - so "03-the-signal" matches inside
 * "chapters/03-the-signal.md" and
 * ".studio/gate/03-the-signal.20260717T154022Z.json" (both real shapes used
 * in docs/formats/decisions.md's own worked examples) but never inside the
 * longer, different slug "03-the-signal-appendix". A slug not shaped like the
 * schema pattern never matches anything: this function gates a `final`
 * status, not a place to guess at a caller's typo.
 *
 * @param {string|null} links
 * @param {string} slug
 * @returns {boolean}
 */
export function linksNameChapter(links, slug) {
  if (typeof links !== 'string' || links === '') return false;
  if (typeof slug !== 'string' || !CHAPTER_SLUG_RE.test(slug)) return false;
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundary = '[^0-9a-z-]';
  const pattern = '(^|' + boundary + ')' + escaped + '($|' + boundary + ')';
  return new RegExp(pattern).test(links);
}

/**
 * THE SHARED ELIGIBILITY PREDICATE for the `final` status. A chapter is
 * eligible only when `entries` (parseDecisionsLog's output) contains at least
 * one entry that is BOTH:
 *   1. structurally valid (validateDecisionEntry), and
 *   2. attested by a human: `actor` is EXACTLY the literal string "author",
 *      never a roster slug. docs/formats/decisions.md allows `actor` to be
 *      "author" OR a roster slug (e.g. "fact-checker") for entries in
 *      general, but reaching `final` specifically requires a dated HUMAN
 *      attestation: a roster slug records an agent's editorial judgment, not
 *      the author's human final-pass sign-off `final` represents.
 * and whose `links` field names this exact slug (linksNameChapter).
 *
 * Pure: takes already-parsed entries, touches no filesystem.
 * hooks/post-tool-batch.mjs is the only caller that ever acts on this result;
 * nothing in this module assigns a chapter's status. One-directional by
 * construction: this function only ever answers "may this chapter BE final,"
 * never "should this chapter BECOME final" - promotion is always a human
 * editing progress.json directly, never a hook or CLI write.
 *
 * @param {string} slug
 * @param {ReturnType<typeof parseDecisionsLog>} entries
 * @returns {boolean}
 */
export function isEligibleForFinal(slug, entries) {
  if (!Array.isArray(entries)) return false;
  for (const entry of entries) {
    if (!entry || entry.actor !== 'author') continue;
    if (!validateDecisionEntry(entry).valid) continue;
    if (linksNameChapter(entry.links, slug)) return true;
  }
  return false;
}
