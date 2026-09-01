// what-it-is:   the ns-gate orchestrator engine
// what-it-does: composes the four deterministic engines (claims, stylometry,
//               scrub/injection, scrub/continuity) plus the session-write flag check
//               into a single policy verdict; loads and coerces the gate config per D-03;
//               returns a structured gate report matching S-08 section 11 exactly, plus the
//               stylometry entry's `drift` sibling per ADR-0012 (PF-14 structured drift field);
//               handles per-check verdict derivation and the mode-dependent exit taxonomy;
//               writes and prunes gate reports under .studio/gate/
// why:          all engine logic lives in lib modules per S-07 section 4; bin/ns-gate is
//               a thin shell; hooks/stop-gate.mjs (TSK-034) is the subprocess boundary
// used-by:      bin/ns-gate, and hooks/stop-gate.mjs, which imports ALL_FLAGS directly

// EXIT TAXONOMY - the gate is the policy layer and is mode-DEPENDENT by design.
// CONTRAST with individual engines (ns-claims, ns-stylometry, ns-scrub, ns-doctor),
// which are mode-INDEPENDENT: they exit 1 on findings regardless of config gate mode.
// Gate exits:
//   0 - final verdict is pass, warn, or skip (no blocking condition triggered)
//   1 - final verdict is block (requires top-level gate.mode != "warn" AND a failing
//       block-mode check); ns-gate is the ONLY CLI where config mode affects exit code
//   2 - operational error anywhere (engine throw, config read error); errors are never
//       suppressed by warn mode; 2 beats 1 beats 0 across the run

import {
  readFileSync, existsSync, mkdirSync, writeFileSync,
  readdirSync, unlinkSync
} from 'node:fs';
import { join, relative } from 'node:path';
import { computeCoverage, scanChapter, scanQuoteAnchors, computeQuoteFindings } from './claims-engine.mjs';
import { measureBook, measureChapter, countWords, computeDrift } from './stylometry-engine.mjs';
import { scrub } from './scrub-engine.mjs';
import { parseEvidenceLog } from './ledger.mjs';
// [TSK-029b (state-coherence gate check) 2026-07-18 per OQ-13 (gate coherence check) decision:
//  reuses the exported checkWordCountCoherence from doctor-engine.mjs; one implementation,
//  two callers (runChecks and the gate). No word-count comparison logic is duplicated here.]
import { checkWordCountCoherence } from './doctor-engine.mjs';

// Check registry: CLI flag -> report check name
// 'claims'           -> 'claim_coverage'  -> computeCoverage
// 'quotes'           -> 'quote_fidelity'  -> scanQuoteAnchors + computeQuoteFindings
//   [OPP-D03 (quote fidelity and source packets) 2026-08-09, roadmap row 1.5: block mode
//    is structurally coerced to warn in loadGateConfig below until the normalization and
//    adjudication policy ships]
// 'stylometry'       -> 'stylometry'      -> regime-aware: measureChapter+computeDrift per
//                                            chapter (regime "chapter") or measureBook+
//                                            computeDrift on the aggregate (regime "book"),
//                                            per the baseline's own stored calibration.regime
//                                            (ADR-0012, voice verdict scope, Decision 2)
// 'scrub'            -> 'prompt_scrub'    -> scrub(chapters, 'injection')
// 'continuity-quick' -> 'continuity'      -> scrub(chapters, 'continuity')
// 'coherence'        -> 'state_coherence' -> checkWordCountCoherence(root)
//   [TSK-029b (state-coherence gate check) 2026-07-18 per OQ-13 (gate coherence check) decision]
// 'session_write_flag' is always evaluated (not in --check list)
export const CHECK_REGISTRY = [
  { flag: 'claims',           reportName: 'claim_coverage' },
  { flag: 'quotes',           reportName: 'quote_fidelity' },
  { flag: 'stylometry',       reportName: 'stylometry' },
  { flag: 'scrub',            reportName: 'prompt_scrub' },
  { flag: 'continuity-quick', reportName: 'continuity' },
  { flag: 'coherence',        reportName: 'state_coherence' },
];

// All valid --check flag values
export const ALL_FLAGS = CHECK_REGISTRY.map(r => r.flag);

// Severity order for verdict aggregation: skip < pass < warn < block
const SEVERITY = { skip: 1, pass: 2, warn: 3, block: 4 };

function maxVerdict(a, b) {
  return (SEVERITY[a] || 0) >= (SEVERITY[b] || 0) ? a : b;
}

// MIN_SCORABLE_CHAPTER_WORDS (P6, ADR-0012 voice verdict scope): chapter regime scores each
// chapter separately, so a stub or empty chapter file -- a normal, modeled state on a fresh
// book, created by scaffolding before the author has written anything -- must never crash the
// check by handing computeDrift a scoredWords the calibration ladder was never measured near.
// 50 is round and comfortably below the shipped ladder's own first rung (550 words): it excludes
// only genuinely unwritten placeholder text, not any real short chapter.
const MIN_SCORABLE_CHAPTER_WORDS = 50;

// MIN_BOOK_VERDICT_WORDS (P6, ADR-0012 voice verdict scope): book regime blocks only once the
// aggregate reaches this many scored words. Task 1's probe (re-derived at N=1000 under the
// exact shipped statistic; the citation source of record is the Task 1 decision record, not the
// earlier PF-21 table) measured every source's detectability statistic clearing 0.96 AUC by
// 2,200 scored words -- the calibration ladder's own third rung -- with growing margin beyond
// it. That is the book-scale line ADR-0012 (voice verdict scope) itself draws: below it, a block
// would reintroduce exactly the unsupported verdict the book regime exists to avoid, so the
// check reports pass-with-advice instead of blocking.
const MIN_BOOK_VERDICT_WORDS = 2200;

// Default gate config per S-08 section 4 sample
const DEFAULT_GATE = {
  mode: 'warn',
  checks: {
    claim_coverage:     { enabled: true, mode: 'block' },
    // [OPP-D03 (quote fidelity and source packets) 2026-08-09 per roadmap row 1.5:
    //  default mode is warn, and loadGateConfig below structurally coerces any configured
    //  'block' back down to 'warn' -- block mode is not reachable until the quote normalization
    //  and adjudication policy ships. This mirrors the D-03 Invariant 1 mechanism used for
    //  thesis_alignment, just below.]
    quote_fidelity:     { enabled: true, mode: 'warn' },
    prompt_scrub:       { enabled: true, mode: 'block' },
    stylometry:         { enabled: true, mode: 'warn' },
    continuity:         { enabled: true, mode: 'warn' },
    // [TSK-029b (state-coherence gate check) 2026-07-18 per OQ-13 (gate coherence check) decision:
    //  default mode is warn because out-of-session edits produce benign mismatches until the
    //  PostToolBatch hook refreshes progress.json; authors opt it to block per normal D-03 opt-in.]
    state_coherence:    { enabled: true, mode: 'warn' },
    thesis_alignment:   { enabled: true, mode: 'warn' },
    session_write_flag: { enabled: true, mode: 'block' },
  },
};

/**
 * Loads the gate config from .studio/config.json and applies the two D-03 invariants.
 *
 * Missing gate block -> defaults from DEFAULT_GATE.
 * D-03 Invariant 1: thesis_alignment.mode "block" is coerced to "warn"; notice to stderr.
 * D-03 Invariant 2 is applied at verdict time (top-level capping is in runGate).
 * Unknown check names and threshold keys are preserved per S-08 Rule 2.
 *
 * @param {string}   root      - absolute book root path
 * @param {Function} [stderrFn] - optional stderr write function; defaults to process.stderr.write
 * @returns {{ gate: object, thresholds: object, coercionNotice: string|null }}
 */
export function loadGateConfig(root, stderrFn) {
  const stderr = stderrFn || (s => process.stderr.write(s));

  let rawConfig = null;
  const configPath = join(root, '.studio', 'config.json');
  if (existsSync(configPath)) {
    rawConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  }

  // If gate block is absent, use defaults
  const rawGate = (rawConfig && rawConfig.gate) ? rawConfig.gate : DEFAULT_GATE;
  const thresholds = (rawConfig && rawConfig.thresholds) ? rawConfig.thresholds : {};

  // Build effective gate config preserving unknown fields (S-08 Rule 2)
  const gate = {
    mode: rawGate.mode != null ? rawGate.mode : 'warn',
    checks: {},
  };
  // Copy any extra fields from rawGate (Rule 2 round-trip)
  for (const k of Object.keys(rawGate)) {
    if (k !== 'mode' && k !== 'checks') gate[k] = rawGate[k];
  }

  // Merge check configs: start with defaults, overlay raw values
  const rawChecks = rawGate.checks || {};
  for (const name of Object.keys(DEFAULT_GATE.checks)) {
    gate.checks[name] = Object.assign({}, DEFAULT_GATE.checks[name], rawChecks[name] || {});
  }
  // Preserve unknown check names per S-08 Rule 2
  for (const name of Object.keys(rawChecks)) {
    if (!gate.checks[name]) {
      gate.checks[name] = Object.assign({}, rawChecks[name]);
    }
  }

  // D-03 Invariant 1: judgment check thesis_alignment must never block in v1
  let coercionNotice = null;
  if (gate.checks.thesis_alignment && gate.checks.thesis_alignment.mode === 'block') {
    gate.checks.thesis_alignment = Object.assign({}, gate.checks.thesis_alignment, { mode: 'warn' });
    coercionNotice =
      'ns-gate: coercion notice: thesis_alignment.mode coerced from "block" to "warn"' +
      ' per D-03 (judgment checks cannot block in v1)\n';
    stderr(coercionNotice);
  }

  // Structural guarantee (D-03 layered Stop gate; roadmap row 1.5): quote_fidelity cannot
  // block until the quote normalization and adjudication policy ships. Mirrors the D-03
  // Invariant 1 mechanism above exactly, so no one can promote
  // this check to blocking by editing config alone -- warn-mode-first is a property of the
  // code, not a convention.
  if (gate.checks.quote_fidelity && gate.checks.quote_fidelity.mode === 'block') {
    gate.checks.quote_fidelity = Object.assign({}, gate.checks.quote_fidelity, { mode: 'warn' });
    const quoteCoercionNotice =
      'ns-gate: coercion notice: quote_fidelity.mode coerced from "block" to "warn"' +
      ' per roadmap row 1.5 (quote fidelity requires the normalization and adjudication policy, not yet shipped)\n';
    stderr(quoteCoercionNotice);
    coercionNotice = (coercionNotice || '') + quoteCoercionNotice;
  }

  return { gate, thresholds, coercionNotice };
}

/**
 * Reads all chapter files from the book root, optionally filtered by slug.
 *
 * @param {string}      root        - absolute book root
 * @param {string|null} chapterSlug - single slug or null for all
 * @returns {{ file: string, text: string }[]} bible-relative file + text pairs
 */
function loadChapters(root, chapterSlug) {
  const chapterDir = join(root, 'chapters');
  if (!existsSync(chapterDir)) return [];

  let names;
  if (chapterSlug) {
    const name = chapterSlug + '.md';
    if (!existsSync(join(chapterDir, name))) return [];
    names = [name];
  } else {
    names = readdirSync(chapterDir).filter(f => f.endsWith('.md')).sort();
  }

  return names.map(name => {
    const absPath = join(chapterDir, name);
    const text = readFileSync(absPath, 'utf8');
    const file = relative(root, absPath).replace(/\\/g, '/');
    return { file, text };
  });
}

/**
 * Constructs a per-check entry for the S-08 section 11 report.
 * Exact keys: check, verdict, detail, evidence, next - NO extras, with ONE named exception:
 * the stylometry entry alone also carries a structured `drift` sibling to `detail` (PF-14,
 * ADR-0012 voice verdict scope Decision 2) - see the STYLOMETRY block below, which merges that
 * field onto the object this function returns rather than widening this function's own
 * signature for every other check.
 *
 * @param {string}       checkName - report check name (e.g., 'claim_coverage')
 * @param {string}       verdict   - 'pass', 'warn', 'block', or 'skip'
 * @param {string}       detail    - human summary with signal token when fired
 * @param {string[]}     evidence  - bible-relative pointer array
 * @param {string|null}  next      - actionable sentence or null on pass/skip
 * @returns {{ check, verdict, detail, evidence, next }}
 */
function makeEntry(checkName, verdict, detail, evidence, next) {
  return {
    check: checkName,
    verdict,
    detail,
    evidence: evidence || [],
    next: next !== undefined ? next : null,
  };
}

/**
 * Derives the effective verdict for a check given its config and whether it has findings.
 *
 * Rules per brief:
 *   - enabled: false -> skip
 *   - mode: 'off'   -> skip
 *   - no findings   -> pass
 *   - findings      -> the configured mode ('warn' or 'block')
 * Engine throws are handled by the caller (skip + exit 2).
 *
 * @param {object} checkConfig - the gate.checks[name] config entry
 * @param {boolean} hasFindings
 * @returns {string} verdict
 */
function deriveVerdict(checkConfig, hasFindings) {
  if (!checkConfig || checkConfig.enabled === false) return 'skip';
  const mode = checkConfig.mode || 'warn';
  if (mode === 'off') return 'skip';
  if (!hasFindings) return 'pass';
  return mode === 'block' ? 'block' : 'warn';
}

/**
 * Main gate orchestrator. Runs the requested checks in-process and returns a
 * gate report matching S-08 section 11 exactly (plus the stylometry entry's
 * `drift` sibling per ADR-0012) and the aggregate exit code.
 *
 * @param {string} root - absolute path to the book root
 * @param {object} [opts]
 * @param {string[]|null} [opts.checkSubset]  - check flag names to run (null = all four)
 * @param {string|null}   [opts.chapterSlug]  - single chapter slug or null for all
 * @param {Function}      [opts.stderrFn]     - optional stderr override
 * @returns {{ exitCode: 0|1|2, report: object|null, coercionNotice: string|null }}
 */
export function runGate(root, opts = {}) {
  const { checkSubset, chapterSlug, stderrFn } = opts;

  // Load config; D-03 Invariant 1 applied here
  let gate, thresholds, coercionNotice;
  try {
    ({ gate, thresholds, coercionNotice } = loadGateConfig(root, stderrFn));
  } catch (err) {
    return { exitCode: 2, report: null, coercionNotice: null };
  }

  // Determine which report-level check names to include
  // 'not in --check subset means omitted entirely' (except session_write_flag)
  const requestedFlags = checkSubset || ALL_FLAGS;
  const requestedReportNames = new Set();
  for (const reg of CHECK_REGISTRY) {
    if (requestedFlags.includes(reg.flag)) {
      requestedReportNames.add(reg.reportName);
    }
  }
  // session_write_flag is always present
  requestedReportNames.add('session_write_flag');

  // Load chapter files (scoped by --chapter if provided)
  let chapters;
  try {
    chapters = loadChapters(root, chapterSlug);
  } catch (err) {
    return { exitCode: 2, report: null, coercionNotice };
  }

  // Read the full config once for stylometry baseline (needed when chapters exist)
  let fullConfig = null;
  const configPath = join(root, '.studio', 'config.json');
  if (existsSync(configPath)) {
    try {
      fullConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      // handled in stylometry block below
    }
  }

  let hasEngineError = false;
  const checkEntries = [];

  // ---- CLAIM COVERAGE ----
  if (requestedReportNames.has('claim_coverage')) {
    const reportName = 'claim_coverage';
    const ccConfig = gate.checks[reportName];

    if (!ccConfig || ccConfig.enabled === false) {
      checkEntries.push(makeEntry(reportName, 'skip', 'check disabled in config', [], null));
    } else if ((ccConfig.mode || 'warn') === 'off') {
      checkEntries.push(makeEntry(reportName, 'skip', 'check mode is off in config', [], null));
    } else if (chapters.length === 0) {
      // No chapters: 100% coverage by definition
      checkEntries.push(makeEntry(reportName, 'pass', 'no chapters to scan; claim_coverage.pass', [], null));
    } else {
      try {
        // Load evidence ledger whole-book (orphan resolution needs the full ledger)
        const ledgerPath = join(root, 'research', 'evidence-log.md');
        let ledgerEntries = [];
        if (existsSync(ledgerPath)) {
          ledgerEntries = parseEvidenceLog(readFileSync(ledgerPath, 'utf8'));
        }

        const scanned = chapters.map(c => ({
          file: c.file,
          markers: scanChapter(c.text, ledgerEntries),
        }));

        const coverage = computeCoverage(scanned, ledgerEntries);
        const hasFindings = coverage.openClaims > 0;
        const verdict = deriveVerdict(ccConfig, hasFindings);

        let detail, evidence, next;
        if (!hasFindings) {
          detail = 'claim coverage 100%; no open markers';
          evidence = [];
          next = null;
        } else {
          const firstType = coverage.findings.length > 0
            ? coverage.findings[0].type
            : 'claim_coverage.unresolved';
          detail = coverage.openClaims + ' open claim(s); ' + firstType;
          evidence = coverage.findings
            .filter(f => f.file && f.line != null)
            .map(f => f.file + '#L' + f.line);
          next = 'Add a [claim: EV-nnnn] marker or tag the sentence [UNVERIFIED] to resolve each open claim.';
        }

        checkEntries.push(makeEntry(reportName, verdict, detail, evidence, next));
      } catch (err) {
        checkEntries.push(makeEntry(reportName, 'skip', 'engine error: ' + err.message, [], null));
        hasEngineError = true;
      }
    }
  }

  // ---- QUOTE FIDELITY ----
  // [OPP-D03 (quote fidelity and source packets) 2026-08-09, roadmap row 1.5: comparison
  //  is character-for-character with NO normalization -- normalizing here would hide
  //  exactly the mismatch classes the deferred normalization and adjudication policy has
  //  to adjudicate. Block mode is structurally coerced to warn in loadGateConfig above,
  //  regardless of what config.json requests.]
  if (requestedReportNames.has('quote_fidelity')) {
    const reportName = 'quote_fidelity';
    const qfConfig = gate.checks[reportName];

    if (!qfConfig || qfConfig.enabled === false) {
      checkEntries.push(makeEntry(reportName, 'skip', 'check disabled in config', [], null));
    } else if ((qfConfig.mode || 'warn') === 'off') {
      checkEntries.push(makeEntry(reportName, 'skip', 'check mode is off in config', [], null));
    } else if (chapters.length === 0) {
      checkEntries.push(makeEntry(reportName, 'pass', 'no chapters to scan; quote_fidelity.pass', [], null));
    } else {
      try {
        const ledgerPath = join(root, 'research', 'evidence-log.md');
        let ledgerEntries = [];
        if (existsSync(ledgerPath)) {
          ledgerEntries = parseEvidenceLog(readFileSync(ledgerPath, 'utf8'));
        }

        const scannedQuotes = chapters.map(c => ({
          file: c.file,
          anchors: scanQuoteAnchors(c.text, ledgerEntries),
        }));

        const { findings: quoteFindings, totalAnchors } = computeQuoteFindings(scannedQuotes);
        const hasFindings = quoteFindings.length > 0;
        const verdict = deriveVerdict(qfConfig, hasFindings);

        let detail, evidence, next;
        if (!hasFindings) {
          detail = totalAnchors + ' quote anchor(s) checked; all match verbatim excerpts exactly';
          evidence = [];
          next = null;
        } else {
          const firstType = quoteFindings[0].type;
          detail = quoteFindings.length + ' quote finding(s); ' + firstType;
          evidence = quoteFindings
            .filter(f => f.file && f.line != null)
            .map(f => f.file + '#L' + f.line);
          next = 'Compare the quoted span against the verbatim excerpt in research/evidence-log.md and correct the mismatch.';
        }

        checkEntries.push(makeEntry(reportName, verdict, detail, evidence, next));
      } catch (err) {
        checkEntries.push(makeEntry(reportName, 'skip', 'engine error: ' + err.message, [], null));
        hasEngineError = true;
      }
    }
  }

  // ---- STYLOMETRY ----
  if (requestedReportNames.has('stylometry')) {
    const reportName = 'stylometry';
    const styloConfig = gate.checks[reportName];

    if (!styloConfig || styloConfig.enabled === false) {
      checkEntries.push(makeEntry(reportName, 'skip', 'check disabled in config', [], null));
    } else if ((styloConfig.mode || 'warn') === 'off') {
      checkEntries.push(makeEntry(reportName, 'skip', 'check mode is off in config', [], null));
    } else if (chapters.length === 0 || chapters.every(c => countWords(c.text) === 0)) {
      // No chapters, or every chapter file measures to zero scored words (a stranger edge case
      // than a single stub -- every chapter would have to be genuinely empty text -- but
      // computeDrift's own scoredWords > 0 guard would otherwise turn it into a plain
      // engine-error skip rather than this honest "nothing to measure" pass; P6).
      checkEntries.push(makeEntry(reportName, 'pass', 'no chapters to measure; stylometry.pass', [], null));
    } else {
      try {
        // Baseline must exist when chapters are present
        if (
          !fullConfig ||
          !fullConfig.stylometry ||
          !fullConfig.stylometry.baseline ||
          !fullConfig.stylometry.baseline.markers
        ) {
          throw new Error('no baseline vector in config.json (stylometry.baseline.markers missing or null)');
        }
        const baseline = fullConfig.stylometry.baseline;

        const aggregateWords = chapters.reduce((sum, c) => sum + countWords(c.text), 0);

        // One probe call against the book-level aggregate: validates the baseline (any
        // StaleBaselineError/InvalidCalibrationError bubbles to this block's existing
        // try/catch below exactly like any other engine error -- skip verdict, exit code 2 --
        // P6's "baseline/calibration errors keep flowing through the existing try/catch skip
        // path"), reads the regime computeDrift itself already resolved from the baseline
        // (never re-derived from baseline.calibration.regime directly, so a malformed
        // calibration object fails through the SAME typed-error path instead of a bare
        // TypeError), and doubles as the book regime's own aggregate result below.
        const aggregateResult = computeDrift(
          measureBook(chapters.map(c => c.text)), baseline, thresholds, { scoredWords: aggregateWords }
        );
        const regime = aggregateResult.regime;
        const deprecations = aggregateResult.deprecations;

        let verdict, detail, evidence, next, driftField;

        if (regime === 'book') {
          // Book regime: the aggregate alone drives the verdict; per-chapter figures are
          // advisory only and never affect it (P6).
          const perChapterAdvice = [];
          const skipped = [];
          for (const c of chapters) {
            const words = countWords(c.text);
            if (words < MIN_SCORABLE_CHAPTER_WORDS) {
              skipped.push({ file: c.file, reason: 'below ' + MIN_SCORABLE_CHAPTER_WORDS + ' scorable words' });
              continue;
            }
            const chResult = computeDrift(measureChapter(c.text), baseline, thresholds, { scoredWords: words });
            perChapterAdvice.push({ file: c.file, statistic: chResult.statistic, worst_marker: chResult.worstMarker });
          }

          const belowFloor = aggregateWords < MIN_BOOK_VERDICT_WORDS;
          const anyExceeded = !belowFloor && aggregateResult.exceeded;
          verdict = deriveVerdict(styloConfig, anyExceeded);

          if (belowFloor) {
            detail =
              'book-scale verdict only: ' + aggregateWords + ' scored word(s) is below the ' +
              MIN_BOOK_VERDICT_WORDS + '-word floor a supportable book-scale verdict needs; ' +
              'reporting for advice only, never blocking below the floor';
            evidence = [];
            next = null;
          } else if (!anyExceeded) {
            detail =
              'book-scale drift statistic ' + aggregateResult.statistic.toFixed(2) +
              ' within threshold ' + aggregateResult.threshold.toFixed(2);
            evidence = [];
            next = null;
          } else {
            detail =
              'book-scale drift statistic ' + aggregateResult.statistic.toFixed(2) +
              ' exceeds threshold ' + aggregateResult.threshold.toFixed(2) +
              '; stylometry.drift-threshold';
            evidence = chapters.map(c => c.file);
            next = 'Review the flagged markers against the voice baseline and revise the drifted chapters.';
          }

          driftField = {
            regime: 'book',
            statistic: aggregateResult.statistic,
            threshold: aggregateResult.threshold,
            worst_marker: aggregateResult.worstMarker,
            worst_chapter: null,
            per_chapter: perChapterAdvice,
            skipped,
          };
        } else {
          // Chapter regime: each chapter is scored, and judged, on its own.
          const perChapter = [];
          const skipped = [];
          let worst = null; // { file, statistic, worstMarker, threshold, ratio }
          const exceedingFiles = [];

          for (const c of chapters) {
            const words = countWords(c.text);
            if (words < MIN_SCORABLE_CHAPTER_WORDS) {
              skipped.push({ file: c.file, reason: 'below ' + MIN_SCORABLE_CHAPTER_WORDS + ' scorable words' });
              continue;
            }
            const r = computeDrift(measureChapter(c.text), baseline, thresholds, { scoredWords: words });
            perChapter.push({ file: c.file, statistic: r.statistic, worst_marker: r.worstMarker });
            if (r.exceeded) exceedingFiles.push(c.file);
            // "Worst" chapter is ranked by statistic/threshold RATIO, not raw statistic:
            // thresholds are resolved per chapter from the calibration ladder (log-linear on
            // that chapter's own scoredWords), so a shorter chapter can carry a materially
            // different threshold than a longer one. A raw-statistic argmax can then pick a
            // chapter that never exceeded ITS OWN threshold over one that did, and even print a
            // self-contradictory "statistic < threshold" sentence on the exceeds branch. Ranking
            // by ratio means "worst" always means "furthest past (or closest to) its own
            // threshold" -- honest under per-span thresholds, and it guarantees the exceeds
            // branch names an actually-exceeding chapter (review round 1, Finding 2).
            const ratio = r.statistic / r.threshold;
            if (!worst || ratio > worst.ratio) {
              worst = {
                file: c.file, statistic: r.statistic, worstMarker: r.worstMarker,
                threshold: r.threshold, ratio,
              };
            }
          }

          const anyExceeded = exceedingFiles.length > 0;
          verdict = deriveVerdict(styloConfig, anyExceeded);

          if (!worst) {
            detail = 'no scorable chapters (all below ' + MIN_SCORABLE_CHAPTER_WORDS + ' words); stylometry.pass';
            evidence = [];
            next = null;
          } else if (!anyExceeded) {
            detail =
              'worst chapter ' + worst.file + ' (worst marker ' + worst.worstMarker +
              '): drift statistic ' + worst.statistic.toFixed(2) +
              ' within threshold ' + worst.threshold.toFixed(2);
            evidence = [];
            next = null;
          } else {
            detail =
              'worst chapter ' + worst.file + ' (worst marker ' + worst.worstMarker +
              '): drift statistic ' + worst.statistic.toFixed(2) +
              ' exceeds threshold ' + worst.threshold.toFixed(2) +
              '; stylometry.drift-threshold';
            evidence = exceedingFiles;
            next = 'Review the flagged markers against the voice baseline and revise the drifted chapter.';
          }

          driftField = {
            regime: 'chapter',
            statistic: worst ? worst.statistic : null,
            threshold: worst ? worst.threshold : null,
            worst_marker: worst ? worst.worstMarker : null,
            worst_chapter: worst ? worst.file : null,
            per_chapter: perChapter,
            skipped,
          };
        }

        // P7: the retirement notice is surfaced once per run in the check detail (the CLI
        // surfaces the same string to stderr; both surfaces are tested).
        if (deprecations.length > 0) {
          detail += '; ' + deprecations[0];
        }

        const entry = makeEntry(reportName, verdict, detail, evidence, next);
        entry.drift = driftField;
        checkEntries.push(entry);
      } catch (err) {
        checkEntries.push(makeEntry(reportName, 'skip', 'engine error: ' + err.message, [], null));
        hasEngineError = true;
      }
    }
  }

  // ---- PROMPT SCRUB (injection mode) ----
  if (requestedReportNames.has('prompt_scrub')) {
    const reportName = 'prompt_scrub';
    const scrubConfig = gate.checks[reportName];

    if (!scrubConfig || scrubConfig.enabled === false) {
      checkEntries.push(makeEntry(reportName, 'skip', 'check disabled in config', [], null));
    } else if ((scrubConfig.mode || 'warn') === 'off') {
      checkEntries.push(makeEntry(reportName, 'skip', 'check mode is off in config', [], null));
    } else if (chapters.length === 0) {
      checkEntries.push(makeEntry(reportName, 'pass', 'no chapters to scan; prompt_scrub.pass', [], null));
    } else {
      try {
        const findings = scrub(chapters, 'injection');
        const hasFindings = findings.length > 0;
        const verdict = deriveVerdict(scrubConfig, hasFindings);

        let detail, evidence, next;
        if (!hasFindings) {
          detail = 'no agent scaffolding or prompt residue found';
          evidence = [];
          next = null;
        } else {
          const firstType = findings[0].type;
          detail = findings.length + ' scrub finding(s); ' + firstType;
          evidence = findings
            .filter(f => f.file && f.line != null)
            .map(f => f.file + '#L' + f.line);
          next = 'Remove agent instructions and template markers from the chapter text before publishing.';
        }

        checkEntries.push(makeEntry(reportName, verdict, detail, evidence, next));
      } catch (err) {
        checkEntries.push(makeEntry(reportName, 'skip', 'engine error: ' + err.message, [], null));
        hasEngineError = true;
      }
    }
  }

  // ---- CONTINUITY (continuity mode) ----
  if (requestedReportNames.has('continuity')) {
    const reportName = 'continuity';
    const contConfig = gate.checks[reportName];

    if (!contConfig || contConfig.enabled === false) {
      checkEntries.push(makeEntry(reportName, 'skip', 'check disabled in config', [], null));
    } else if ((contConfig.mode || 'warn') === 'off') {
      checkEntries.push(makeEntry(reportName, 'skip', 'check mode is off in config', [], null));
    } else if (chapters.length === 0) {
      checkEntries.push(makeEntry(reportName, 'pass', 'no chapters to scan; continuity.pass', [], null));
    } else {
      try {
        const findings = scrub(chapters, 'continuity');
        const hasFindings = findings.length > 0;
        const verdict = deriveVerdict(contConfig, hasFindings);

        let detail, evidence, next;
        if (!hasFindings) {
          detail = 'no name consistency issues found';
          evidence = [];
          next = null;
        } else {
          const firstFinding = findings[0];
          // Include signal token and the engine detail (which names both surface forms)
          detail =
            findings.length + ' finding(s); continuity.name-mismatch; ' +
            (firstFinding.detail || '');
          evidence = findings
            .filter(f => f.file && f.line != null)
            .map(f => f.file + '#L' + f.line);
          next = 'Reconcile the inconsistent term forms across chapters.';
        }

        checkEntries.push(makeEntry(reportName, verdict, detail, evidence, next));
      } catch (err) {
        checkEntries.push(makeEntry(reportName, 'skip', 'engine error: ' + err.message, [], null));
        hasEngineError = true;
      }
    }
  }

  // ---- STATE COHERENCE ----
  // [TSK-029b (state-coherence gate check) 2026-07-18 per OQ-13 (gate coherence check) decision:
  //  reuses checkWordCountCoherence imported from doctor-engine.mjs. One implementation,
  //  two callers. Default mode warn per OQ-13 rationale (benign mismatches from out-of-session
  //  edits before PostToolBatch refreshes progress.json); authors opt to block per D-03 opt-in.]
  if (requestedReportNames.has('state_coherence')) {
    const reportName = 'state_coherence';
    const cohConfig = gate.checks[reportName];

    if (!cohConfig || cohConfig.enabled === false) {
      checkEntries.push(makeEntry(reportName, 'skip', 'check disabled in config', [], null));
    } else if ((cohConfig.mode || 'warn') === 'off') {
      checkEntries.push(makeEntry(reportName, 'skip', 'check mode is off in config', [], null));
    } else {
      try {
        const coherenceFindings = checkWordCountCoherence(root);
        const hasFindings = coherenceFindings.length > 0;
        const verdict = deriveVerdict(cohConfig, hasFindings);

        let detail, evidence, next;
        if (!hasFindings) {
          detail = 'word-count coherence pass; no mismatch between chapters and progress.json';
          evidence = [];
          next = null;
        } else {
          const first = coherenceFindings[0];
          // detail carries the finding type string verbatim plus the chapter and both counts
          // (reuses the finding's own message which already names the chapter and both counts)
          detail =
            coherenceFindings.length + ' word-count mismatch(es); ' +
            first.type + '; ' + first.message;
          // evidence: the chapter file paths (from finding.path) plus .studio/progress.json
          // (the two sides of the incoherence: chapter file has actual count, progress.json
          // has the recorded count)
          evidence = coherenceFindings
            .filter(f => f.path)
            .map(f => f.path);
          evidence.push('.studio/progress.json');
          next = 'Run ns-doctor to diagnose the word-count incoherence and update progress.json.';
        }

        checkEntries.push(makeEntry(reportName, verdict, detail, evidence, next));
      } catch (err) {
        checkEntries.push(makeEntry(reportName, 'skip', 'engine error: ' + err.message, [], null));
        hasEngineError = true;
      }
    }
  }

  // ---- SESSION WRITE FLAG (always evaluated; ns-gate never blocks on this check) ----
  {
    const reportName = 'session_write_flag';
    const flagPath = join(root, '.studio', 'gate', '.session-write-flag');

    if (existsSync(flagPath)) {
      // Present: pass with the flag path as evidence
      checkEntries.push(makeEntry(
        reportName,
        'pass',
        'session write flag present',
        ['.studio/gate/.session-write-flag'],
        null
      ));
    } else {
      // Absent: informational skip; ns-gate never blocks on this
      checkEntries.push(makeEntry(
        reportName,
        'skip',
        'no chapter writes detected in this session; gate.no-write',
        [],
        null
      ));
    }
  }

  // ---- Compute top-level verdict ----
  // Maximum severity across all included check entries
  let topVerdict = 'pass';
  for (const entry of checkEntries) {
    topVerdict = maxVerdict(topVerdict, entry.verdict);
  }

  // D-03 Invariant 2: when top-level gate.mode is "warn", cap the top-level verdict
  // at "warn" (per-check entries keep their actual verdict so authors see what would
  // block once they opt in). This honors "all checks report but none block" in S-08 section 4.
  if (gate.mode === 'warn' && topVerdict === 'block') {
    topVerdict = 'warn';
  }

  // Final exit code: 2 beats 1 beats 0
  let exitCode = 0;
  if (hasEngineError) {
    exitCode = 2;
  } else if (topVerdict === 'block') {
    exitCode = 1;
  }

  // Build the S-08 section 11 report (exact keys: version, chapter, ts, verdict, checks)
  const ts = toUTCSeconds(new Date());
  const chapter = chapterSlug || 'all';

  const report = {
    version: 2,
    chapter,
    ts,
    verdict: topVerdict,
    checks: checkEntries,
  };

  return { exitCode, report, coercionNotice };
}

/**
 * Formats a Date as a compact UTC timestamp safe for Windows filenames.
 * Format: YYYYMMDDTHHMMSSZ (no milliseconds; ISO 8601 compact)
 *
 * @param {Date} [d] - date to format (default: now)
 * @returns {string}
 */
export function formatTimestamp(d) {
  const date = d || new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

/**
 * Returns an ISO 8601 UTC string with seconds precision (no milliseconds).
 * Used for the report's ts field.
 *
 * @param {Date} d
 * @returns {string}
 */
function toUTCSeconds(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Writes the gate report to .studio/gate/<slug>.<YYYYMMDDTHHMMSSZ>.json and prunes
 * to the last 10 reports per slug (mirror of the snapshot retention policy in S-08 section 10).
 *
 * ns-gate writes ONLY under .studio/gate/ per D-06 (single-writer state discipline);
 * it never touches progress.json or any bible file.
 *
 * @param {string} root   - absolute book root path
 * @param {object} report - S-08 section 11 gate report object (must include chapter and ts)
 * @returns {{ reportPath: string }} bible-relative path of the written report
 */
export function writeGateReport(root, report) {
  const gateDir = join(root, '.studio', 'gate');
  mkdirSync(gateDir, { recursive: true });

  const slug = report.chapter || 'all';
  // The ts field is ISO 8601 with seconds precision; compact form strips the colons and dashes
  const tsCompact = formatTimestamp(new Date(report.ts));
  const filename = slug + '.' + tsCompact + '.json';
  const absPath = join(gateDir, filename);

  writeFileSync(absPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  // Prune to last 10 per slug after writing
  pruneGateReports(gateDir, slug);

  return { reportPath: relative(root, absPath).replace(/\\/g, '/') };
}

/**
 * Prunes gate reports for a slug to the last 10, keeping the most recent by filename sort.
 * Lexicographic sort equals chronological sort for the YYYYMMDDTHHMMSSZ timestamp format.
 *
 * @param {string} gateDir - absolute path to .studio/gate/
 * @param {string} slug    - chapter slug (e.g., 'all' or '01-intro')
 */
function pruneGateReports(gateDir, slug) {
  const prefix = slug + '.';
  const suffix = '.json';

  const files = readdirSync(gateDir)
    .filter(f => f.startsWith(prefix) && f.endsWith(suffix))
    .sort(); // lexicographic = chronological for YYYYMMDDTHHMMSSZ

  if (files.length > 10) {
    const toDelete = files.slice(0, files.length - 10);
    for (const f of toDelete) {
      try {
        unlinkSync(join(gateDir, f));
      } catch {
        // Best-effort; a prune failure does not fail the gate run
      }
    }
  }
}
