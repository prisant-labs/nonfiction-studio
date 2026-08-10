// what-it-is:   the shared gate report builder for all engine CLIs
// what-it-does: provides makeReport, addFinding, finalize, and emit so every CLI produces
//               the same JSON shape and the same exit-code contract
// why:          ns-claims, ns-notes, and ns-scrub share identical exit-code semantics through
//               this module (0 clean, 1 findings, 2 error); one shared module keeps their JSON
//               shape consistent with gate-report.md and stops the three from drifting apart.
//               ns-doctor, ns-gate, ns-stylometry, and ns-statusline do not import this module.
// used-by:      imported by bin/ns-claims, bin/ns-notes, bin/ns-scrub

// Exit-code contract per S-07 section 4:
//   0 - no findings (checks passed)
//   1 - findings present (issues to review)
//   2 - operational error (reserved; thrown by BibleError / ArgsError callers, not by finalize)
export const EXIT_CLEAN    = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_ERROR    = 2;

/**
 * Creates a new per-check report object.
 * The check name identifies which engine produced this report (for example 'claim_coverage').
 *
 * @param {string} check - the check name as it appears in config.json gate.checks
 * @returns {object} an internal report object; pass to addFinding and finalize
 */
export function makeReport(check) {
  return {
    check,
    findings: [],
    ts: new Date().toISOString(),
  };
}

/**
 * Appends a finding to a report.
 * All fields are optional except those the calling engine populates.
 *
 * @param {object} report  - report created by makeReport
 * @param {object} finding
 * @param {string} [finding.file]    - bible-relative file path (for example 'chapters/01-intro.md')
 * @param {number} [finding.line]    - 1-based line number within the file
 * @param {string} [finding.type]    - finding type slug (for example 'prompt_scrub.ai_framing')
 * @param {string} [finding.excerpt] - short text excerpt at the finding location
 * @param {string} [finding.detail]  - human-readable explanation of the finding
 */
export function addFinding(report, { file = null, line = null, type = null, excerpt = '', detail = '' } = {}) {
  report.findings.push({ file, line, type, excerpt, detail });
}

/**
 * Finalizes the report and computes the exit code.
 *
 * Returns { exitCode, json } where:
 *   exitCode 0 - no findings
 *   exitCode 1 - one or more findings
 *   exitCode 2 - reserved for operational errors; finalize never returns 2
 *
 * The json shape follows docs/formats/gate-report.md per-check entry fields:
 *   { check, verdict, detail, evidence, next, findings }
 *
 * @param {object} report - report created by makeReport (possibly with findings)
 * @returns {{ exitCode: 0|1, json: object }}
 */
export function finalize(report) {
  const hasFindings = report.findings.length > 0;
  const exitCode = hasFindings ? EXIT_FINDINGS : EXIT_CLEAN;
  const verdict = hasFindings ? 'block' : 'pass';

  // Derive evidence pointers from file and line fields on each finding.
  const evidence = report.findings
    .filter(f => f.file)
    .map(f => (f.line != null ? f.file + '#L' + f.line : f.file));

  const detail = hasFindings
    ? report.findings.length + ' issue(s) found'
    : 'no issues found';

  const next = hasFindings
    ? 'Review and resolve the listed findings before continuing.'
    : null;

  const json = {
    check: report.check,
    verdict,
    detail,
    evidence,
    next,
    findings: report.findings,
    ts: report.ts,
  };

  return { exitCode, json };
}

/**
 * Emits the report to stdout in either human-readable or JSON form.
 *
 * @param {object} report     - report created by makeReport
 * @param {object} [opts]
 * @param {boolean} [opts.json] - when true, emit machine-readable JSON; otherwise emit text
 */
export function emit(report, { json: asJson = false } = {}) {
  const { exitCode, json } = finalize(report);

  if (asJson) {
    process.stdout.write(JSON.stringify(json, null, 2) + '\n');
    return exitCode;
  }

  // Human-readable output.
  const prefix = '[' + report.check + ']';
  if (report.findings.length === 0) {
    process.stdout.write(prefix + ' pass: no issues found\n');
  } else {
    process.stdout.write(prefix + ' ' + report.findings.length + ' finding(s):\n');
    for (const f of report.findings) {
      const loc = f.file
        ? (f.line != null ? f.file + ':' + f.line : f.file)
        : '(no file)';
      const typeTag = f.type ? ' [' + f.type + ']' : '';
      process.stdout.write('  ' + loc + typeTag + ': ' + (f.detail || f.excerpt || '') + '\n');
    }
  }

  return exitCode;
}
