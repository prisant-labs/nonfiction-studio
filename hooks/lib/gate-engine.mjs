// what-it-is:   the ns-gate orchestrator engine
// what-it-does: composes the four deterministic engines (claims, stylometry,
//               scrub/injection, scrub/continuity) plus the session-write flag check
//               into a single policy verdict; loads and coerces the gate config per D-03;
//               returns a structured gate report matching S-08 section 11 exactly;
//               handles per-check verdict derivation and the mode-dependent exit taxonomy;
//               writes and prunes gate reports under .studio/gate/
// why:          all engine logic lives in lib modules per S-07 section 4; bin/ns-gate is
//               a thin shell; hooks/stop-gate.mjs (TSK-034) is the subprocess boundary
// used-by:      bin/ns-gate

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
import { computeCoverage, scanChapter } from './claims-engine.mjs';
import { measureBook, computeDrift } from './stylometry-engine.mjs';
import { scrub } from './scrub-engine.mjs';
import { parseEvidenceLog } from './ledger.mjs';

// Check registry: CLI flag -> report check name
// 'claims'           -> 'claim_coverage'  -> computeCoverage
// 'stylometry'       -> 'stylometry'      -> measureBook + computeDrift
// 'scrub'            -> 'prompt_scrub'    -> scrub(chapters, 'injection')
// 'continuity-quick' -> 'continuity'      -> scrub(chapters, 'continuity')
// 'session_write_flag' is always evaluated (not in --check list)
export const CHECK_REGISTRY = [
  { flag: 'claims',           reportName: 'claim_coverage' },
  { flag: 'stylometry',       reportName: 'stylometry' },
  { flag: 'scrub',            reportName: 'prompt_scrub' },
  { flag: 'continuity-quick', reportName: 'continuity' },
];

// All valid --check flag values
export const ALL_FLAGS = CHECK_REGISTRY.map(r => r.flag);

// Severity order for verdict aggregation: skip < pass < warn < block
const SEVERITY = { skip: 1, pass: 2, warn: 3, block: 4 };

function maxVerdict(a, b) {
  return (SEVERITY[a] || 0) >= (SEVERITY[b] || 0) ? a : b;
}

// Default gate config per S-08 section 4 sample
const DEFAULT_GATE = {
  mode: 'warn',
  checks: {
    claim_coverage:     { enabled: true, mode: 'block' },
    prompt_scrub:       { enabled: true, mode: 'block' },
    stylometry:         { enabled: true, mode: 'warn' },
    continuity:         { enabled: true, mode: 'warn' },
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
 * Exact keys: check, verdict, detail, evidence, next - NO extras.
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
 * gate report matching S-08 section 11 exactly plus the aggregate exit code.
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

  // ---- STYLOMETRY ----
  if (requestedReportNames.has('stylometry')) {
    const reportName = 'stylometry';
    const styloConfig = gate.checks[reportName];

    if (!styloConfig || styloConfig.enabled === false) {
      checkEntries.push(makeEntry(reportName, 'skip', 'check disabled in config', [], null));
    } else if ((styloConfig.mode || 'warn') === 'off') {
      checkEntries.push(makeEntry(reportName, 'skip', 'check mode is off in config', [], null));
    } else if (chapters.length === 0) {
      // No chapters: no drift possible
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

        const baseline = fullConfig.stylometry.baseline.markers;
        const chapterTexts = chapters.map(c => c.text);
        const chapterFiles = chapters.map(c => c.file);

        const measured = measureBook(chapterTexts);
        const { score, exceeded } = computeDrift(measured, baseline, thresholds);
        const driftMax = (thresholds && thresholds.drift_score_max != null)
          ? thresholds.drift_score_max : 35;

        const verdict = deriveVerdict(styloConfig, exceeded);

        let detail, evidence, next;
        if (!exceeded) {
          detail = 'drift score ' + score.toFixed(2) + ' within threshold ' + driftMax;
          evidence = [];
          next = null;
        } else {
          // Gate-coined token: stylometry.drift-threshold
          detail =
            'drift score ' + score.toFixed(2) +
            ' exceeds threshold ' + driftMax +
            '; stylometry.drift-threshold';
          // Evidence: chapter file paths (no line anchor for stylometry per brief)
          evidence = chapterFiles;
          next = 'Review the flagged markers against the voice baseline and revise the drifted chapter.';
        }

        checkEntries.push(makeEntry(reportName, verdict, detail, evidence, next));
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
