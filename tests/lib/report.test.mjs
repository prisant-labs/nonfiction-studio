// tests/lib/report.test.mjs
// what-it-is:   unit tests for hooks/lib/report.mjs
// what-it-does: verifies exit-code mapping (0/1/2), finding accumulation, and the JSON shape
// runner:       node --test tests/lib/report.test.mjs (or node --test tests/lib/)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXIT_CLEAN,
  EXIT_FINDINGS,
  EXIT_ERROR,
  makeReport,
  addFinding,
  finalize,
} from '../../hooks/lib/report.mjs';

// ---- exit-code constants -------------------------------------------------------

test('EXIT_CLEAN is 0', () => {
  assert.equal(EXIT_CLEAN, 0);
});

test('EXIT_FINDINGS is 1', () => {
  assert.equal(EXIT_FINDINGS, 1);
});

test('EXIT_ERROR is 2', () => {
  assert.equal(EXIT_ERROR, 2);
});

// ---- exit-code mapping: class 0 (no findings) ----------------------------------

test('finalize returns exitCode 0 when there are zero findings', () => {
  const report = makeReport('claim_coverage');
  const { exitCode } = finalize(report);
  assert.equal(exitCode, 0, 'exitCode is 0 with zero findings');
});

test('finalize returns verdict pass when there are zero findings', () => {
  const report = makeReport('claim_coverage');
  const { json } = finalize(report);
  assert.equal(json.verdict, 'pass');
});

test('finalize returns next null when there are zero findings', () => {
  const report = makeReport('claim_coverage');
  const { json } = finalize(report);
  assert.equal(json.next, null);
});

test('finalize returns empty evidence when there are zero findings', () => {
  const report = makeReport('claim_coverage');
  const { json } = finalize(report);
  assert.deepEqual(json.evidence, []);
});

// ---- exit-code mapping: class 1 (findings present) ----------------------------

test('finalize returns exitCode 1 when there is one finding', () => {
  const report = makeReport('prompt_scrub');
  addFinding(report, { file: 'chapters/01.md', line: 12, type: 'ai_framing', excerpt: 'as an AI', detail: 'AI framing detected' });
  const { exitCode } = finalize(report);
  assert.equal(exitCode, 1, 'exitCode is 1 with findings');
});

test('finalize returns verdict block when there are findings', () => {
  const report = makeReport('prompt_scrub');
  addFinding(report, { file: 'chapters/01.md', line: 5, type: 'template_marker', excerpt: '[TODO]', detail: 'unclosed marker' });
  const { json } = finalize(report);
  assert.equal(json.verdict, 'block');
});

test('finalize returns exitCode 1 with multiple findings', () => {
  const report = makeReport('claim_coverage');
  addFinding(report, { file: 'chapters/01.md', line: 10 });
  addFinding(report, { file: 'chapters/01.md', line: 20 });
  addFinding(report, { file: 'chapters/02.md', line: 5 });
  const { exitCode } = finalize(report);
  assert.equal(exitCode, 1, 'exitCode is 1 with multiple findings');
});

// ---- exit-code mapping: class 2 (reserved; finalize never returns 2) -----------

test('finalize never returns exitCode 2', () => {
  // Verify that finalize only returns 0 or 1; exit code 2 is reserved for operational errors
  // (BibleError, ArgsError) caught by the CLI wrapper, not produced by finalize.
  const emptyReport = makeReport('check');
  assert.notEqual(finalize(emptyReport).exitCode, 2, 'zero findings: not 2');

  const filledReport = makeReport('check');
  addFinding(filledReport, { detail: 'some issue' });
  assert.notEqual(finalize(filledReport).exitCode, 2, 'with findings: not 2');
});

// ---- JSON shape follows gate-report.md per-check entry fields ------------------

test('finalize json has the required gate-report.md check entry fields', () => {
  const report = makeReport('stylometry');
  addFinding(report, {
    file: 'chapters/01-intro.md',
    line: 44,
    type: 'drift',
    excerpt: 'long sentence',
    detail: 'drift_score 38 exceeds threshold 35',
  });
  const { json } = finalize(report);

  // Required gate-report.md fields.
  assert.ok(Object.prototype.hasOwnProperty.call(json, 'check'), 'has check');
  assert.ok(Object.prototype.hasOwnProperty.call(json, 'verdict'), 'has verdict');
  assert.ok(Object.prototype.hasOwnProperty.call(json, 'detail'), 'has detail');
  assert.ok(Object.prototype.hasOwnProperty.call(json, 'evidence'), 'has evidence');
  assert.ok(Object.prototype.hasOwnProperty.call(json, 'next'), 'has next');
  assert.ok(Array.isArray(json.evidence), 'evidence is an array');

  // check field matches the name passed to makeReport.
  assert.equal(json.check, 'stylometry');
});

test('finalize populates evidence from file and line', () => {
  const report = makeReport('claim_coverage');
  addFinding(report, { file: 'chapters/01.md', line: 44 });
  addFinding(report, { file: 'chapters/01.md', line: 61 });
  const { json } = finalize(report);
  assert.deepEqual(json.evidence, ['chapters/01.md#L44', 'chapters/01.md#L61']);
});

test('finalize omits line anchor in evidence when line is null', () => {
  const report = makeReport('claim_coverage');
  addFinding(report, { file: 'chapters/01.md' });
  const { json } = finalize(report);
  assert.deepEqual(json.evidence, ['chapters/01.md']);
});

test('finalize omits findings with no file from evidence', () => {
  const report = makeReport('claim_coverage');
  addFinding(report, { detail: 'no file finding' });
  const { json } = finalize(report);
  assert.deepEqual(json.evidence, []);
  assert.equal(json.findings.length, 1, 'finding still recorded in json.findings');
});

// ---- makeReport ----------------------------------------------------------------

test('makeReport returns an object with check, findings, and ts', () => {
  const report = makeReport('ns_scrub');
  assert.equal(report.check, 'ns_scrub');
  assert.ok(Array.isArray(report.findings), 'findings is an array');
  assert.equal(report.findings.length, 0, 'initially empty');
  assert.ok(typeof report.ts === 'string', 'ts is a string');
});

// ---- addFinding ----------------------------------------------------------------

test('addFinding appends to the findings array', () => {
  const report = makeReport('test_check');
  addFinding(report, { file: 'a.md', line: 1, type: 'T', excerpt: 'X', detail: 'D' });
  addFinding(report, { file: 'b.md', line: 2, type: 'U', excerpt: 'Y', detail: 'E' });
  assert.equal(report.findings.length, 2);
  assert.equal(report.findings[0].file, 'a.md');
  assert.equal(report.findings[1].file, 'b.md');
});

test('addFinding called with no arguments does not throw', () => {
  const report = makeReport('test_check');
  assert.doesNotThrow(() => addFinding(report));
  assert.equal(report.findings.length, 1, 'an empty finding is appended');
});
