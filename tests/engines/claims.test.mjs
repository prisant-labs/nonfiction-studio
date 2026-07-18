// tests/engines/claims.test.mjs
// what-it-is:   unit tests for hooks/lib/claims-engine.mjs
// what-it-does: verifies scanChapter and computeCoverage against four exit-1 fixture classes
//               (orphan EV ID, pending status, [UNVERIFIED] tag, orphan [SOURCE-UNVERIFIABLE]),
//               the two committed-fixture exit-0 cases (golden sample book, unsourced-claim),
//               paired [SOURCE-UNVERIFIABLE] non-doubling, interpretation resolution, and JSON shape
// runner:       node --test tests/engines/claims.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanChapter, computeCoverage } from '../../hooks/lib/claims-engine.mjs';
import { parseEvidenceLog } from '../../hooks/lib/ledger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES = join(__dirname, 'fixtures', 'claims');
const EXAMPLES = join(__dirname, '..', '..', 'examples');

// Convenience reader for named fixture files under tests/engines/fixtures/claims/
function readFixture(name) {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// ---- Exit-1 case 1: orphan marker (EV ID missing from ledger) ------------------

test('orphan claim marker: scanChapter returns one unresolved marker when EV ID is absent', () => {
  const entries = parseEvidenceLog(readFixture('orphan-marker-ledger.md'));
  const markers = scanChapter(readFixture('orphan-marker.md'), entries);

  const open = markers.filter(m => !m.resolved);
  assert.equal(open.length, 1, 'one unresolved marker');
  assert.equal(open[0].form, 'claim', 'form is claim');
  assert.equal(open[0].id, 'EV-9999', 'missing ID is EV-9999');
  assert.ok(typeof open[0].line === 'number' && open[0].line > 0, 'line is a positive integer');
  assert.ok(open[0].reason.includes('EV-9999'), 'reason names the missing ID');
});

test('orphan claim marker: computeCoverage finding has file and line', () => {
  const entries = parseEvidenceLog(readFixture('orphan-marker-ledger.md'));
  const markers = scanChapter(readFixture('orphan-marker.md'), entries);
  const { findings, openClaims } = computeCoverage(
    [{ file: 'chapters/orphan-marker.md', markers }],
    entries
  );
  assert.equal(openClaims, 1);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'chapters/orphan-marker.md');
  assert.ok(typeof findings[0].line === 'number' && findings[0].line > 0, 'finding carries a line number');
});

// ---- Exit-1 case 2: pending status -------------------------------------------

test('pending-status claim: scanChapter returns one unresolved marker', () => {
  const entries = parseEvidenceLog(readFixture('pending-status-ledger.md'));
  const markers = scanChapter(readFixture('pending-status.md'), entries);

  const open = markers.filter(m => !m.resolved);
  assert.equal(open.length, 1, 'one unresolved marker');
  assert.equal(open[0].status, 'pending', 'status is pending');
  assert.ok(open[0].reason.includes('pending'), 'reason mentions pending');
  assert.ok(typeof open[0].line === 'number' && open[0].line > 0, 'line is a positive integer');
});

test('pending-status claim: computeCoverage finding has file and line', () => {
  const entries = parseEvidenceLog(readFixture('pending-status-ledger.md'));
  const markers = scanChapter(readFixture('pending-status.md'), entries);
  const { findings, openClaims } = computeCoverage(
    [{ file: 'chapters/pending-status.md', markers }],
    entries
  );
  assert.equal(openClaims, 1);
  assert.equal(findings[0].file, 'chapters/pending-status.md');
  assert.ok(typeof findings[0].line === 'number' && findings[0].line > 0, 'finding carries a line number');
});

// ---- Exit-1 case 3: [UNVERIFIED] tag -----------------------------------------

test('[UNVERIFIED] tag: scanChapter returns one unresolved marker', () => {
  const markers = scanChapter(readFixture('unverified-tag.md'), []);
  const open = markers.filter(m => !m.resolved);
  assert.equal(open.length, 1, 'one unresolved marker');
  assert.equal(open[0].form, 'unverified', 'form is unverified');
  assert.ok(typeof open[0].line === 'number' && open[0].line > 0, 'line is a positive integer');
});

test('[UNVERIFIED] tag: computeCoverage finding has file and line', () => {
  const markers = scanChapter(readFixture('unverified-tag.md'), []);
  const { findings, openClaims } = computeCoverage(
    [{ file: 'chapters/unverified-tag.md', markers }],
    []
  );
  assert.equal(openClaims, 1);
  assert.equal(findings[0].file, 'chapters/unverified-tag.md');
  assert.ok(typeof findings[0].line === 'number' && findings[0].line > 0, 'finding carries a line number');
});

// ---- Exit-1 case 4: orphan [SOURCE-UNVERIFIABLE] ----------------------------

test('orphan [SOURCE-UNVERIFIABLE]: scanChapter returns one unresolved marker', () => {
  const markers = scanChapter(readFixture('orphan-suv.md'), []);
  const open = markers.filter(m => !m.resolved);
  assert.equal(open.length, 1, 'one unresolved marker');
  assert.equal(open[0].form, 'source-unverifiable', 'form is source-unverifiable');
  assert.equal(open[0].orphan, true, 'marked as orphan');
  assert.ok(typeof open[0].line === 'number' && open[0].line > 0, 'line is a positive integer');
});

test('orphan [SOURCE-UNVERIFIABLE]: computeCoverage finding has file and line', () => {
  const markers = scanChapter(readFixture('orphan-suv.md'), []);
  const { findings, openClaims } = computeCoverage(
    [{ file: 'chapters/orphan-suv.md', markers }],
    []
  );
  assert.equal(openClaims, 1);
  assert.equal(findings[0].file, 'chapters/orphan-suv.md');
  assert.ok(typeof findings[0].line === 'number' && findings[0].line > 0, 'finding carries a line number');
});

// ---- Paired [SOURCE-UNVERIFIABLE] not double-counted -------------------------

test('paired [SOURCE-UNVERIFIABLE] is not counted as an extra open claim', () => {
  // The claim marker is on the same line as [SOURCE-UNVERIFIABLE]; only the claim counts.
  const ledgerText = [
    '### EV-0001 (suv)',
    '- claim: Source resolution failed.',
    '- source: SRC-0001',
    '- locator:',
    '- confidence: medium',
    '- status: source-unverifiable',
    '- added-by: research-librarian',
    '- date: 2026-07-18',
  ].join('\n');
  const entries = parseEvidenceLog(ledgerText);
  const text = 'A claim whose source failed online resolution. [claim: EV-0001] [SOURCE-UNVERIFIABLE]\n';
  const markers = scanChapter(text, entries);

  assert.equal(markers.length, 1, 'only the claim marker is emitted');
  assert.equal(markers[0].form, 'claim', 'the single marker is a claim');
  assert.equal(markers[0].resolved, false, 'source-unverifiable status is not resolved');
});

// ---- interpretation status is a resolved status ------------------------------

test('claim with status interpretation is counted as resolved', () => {
  const ledgerText = [
    '### EV-0001 (interpretation)',
    '- claim: Author opinion on learning styles.',
    '- source: SRC-0001',
    '- locator:',
    '- confidence: medium',
    '- status: interpretation',
    '- added-by: research-librarian',
    '- date: 2026-07-18',
  ].join('\n');
  const entries = parseEvidenceLog(ledgerText);
  const markers = scanChapter('The author argues that X holds broadly. [claim: EV-0001]\n', entries);

  assert.equal(markers.length, 1);
  assert.equal(markers[0].resolved, true, 'interpretation status resolves the marker');
});

// ---- Coverage math -----------------------------------------------------------

test('computeCoverage returns 100.0 when there are zero markers', () => {
  const { coveragePct, openClaims } = computeCoverage([{ file: 'chapters/empty.md', markers: [] }], []);
  assert.equal(coveragePct, 100.0);
  assert.equal(openClaims, 0);
});

test('computeCoverage returns 100.0 when all markers are resolved', () => {
  const ledgerText = [
    '### EV-0001 (test)',
    '- claim: Test claim.',
    '- source: SRC-0001',
    '- locator:',
    '- confidence: high',
    '- status: verified',
    '- added-by: research-librarian',
    '- date: 2026-07-18',
  ].join('\n');
  const entries = parseEvidenceLog(ledgerText);
  const markers = scanChapter('A sentence. [claim: EV-0001]\n', entries);
  const { coveragePct, openClaims } = computeCoverage([{ file: 'chapters/ch.md', markers }], entries);
  assert.equal(coveragePct, 100.0);
  assert.equal(openClaims, 0);
});

test('computeCoverage returns 50.0 when half of two markers are resolved', () => {
  const ledgerText = [
    '### EV-0001 (verified)',
    '- claim: Verified claim.',
    '- source: SRC-0001',
    '- locator:',
    '- confidence: high',
    '- status: verified',
    '- added-by: research-librarian',
    '- date: 2026-07-18',
  ].join('\n');
  const entries = parseEvidenceLog(ledgerText);
  const text = 'Sentence one. [claim: EV-0001]\nSentence two. [UNVERIFIED]\n';
  const markers = scanChapter(text, entries);
  const { coveragePct, openClaims, totalMarkers, resolvedCount } = computeCoverage(
    [{ file: 'chapters/mixed.md', markers }],
    entries
  );
  assert.equal(totalMarkers, 2, 'two markers total');
  assert.equal(resolvedCount, 1, 'one resolved');
  assert.equal(openClaims, 1, 'one open');
  assert.equal(coveragePct, 50.0, 'coverage is 50%');
});

// ---- Committed tree: sample book (golden exit 0) ----------------------------

test('sample book: all chapters scan to 100% coverage with zero open claims', () => {
  const bookRoot = join(EXAMPLES, 'sample-book');
  const ledgerText = readFileSync(join(bookRoot, 'research', 'evidence-log.md'), 'utf8');
  const entries = parseEvidenceLog(ledgerText);

  const ch1Text = readFileSync(join(bookRoot, 'chapters', '01-listening-before-speaking.md'), 'utf8');
  const ch2Text = readFileSync(join(bookRoot, 'chapters', '02-finding-your-network.md'), 'utf8');

  const chapters = [
    { file: 'chapters/01-listening-before-speaking.md', markers: scanChapter(ch1Text, entries) },
    { file: 'chapters/02-finding-your-network.md', markers: scanChapter(ch2Text, entries) },
  ];

  const { coveragePct, openClaims, totalMarkers } = computeCoverage(chapters, entries);
  assert.equal(openClaims, 0, 'no open claims in the golden sample book');
  assert.equal(coveragePct, 100.0, 'coverage is 100%');
  assert.ok(totalMarkers > 0, 'at least one marker was scanned');
});

// ---- Committed tree: unsourced-claim fixture (also exit 0) ------------------

test('unsourced-claim fixture: unmarked sentence is invisible; coverage is 100%', () => {
  const bookRoot = join(EXAMPLES, 'fixtures', 'unsourced-claim');
  const ledgerText = readFileSync(join(bookRoot, 'research', 'evidence-log.md'), 'utf8');
  const entries = parseEvidenceLog(ledgerText);

  const ch1Text = readFileSync(join(bookRoot, 'chapters', '01-listening-before-speaking.md'), 'utf8');
  const ch2Text = readFileSync(join(bookRoot, 'chapters', '02-finding-your-network.md'), 'utf8');

  const chapters = [
    { file: 'chapters/01-listening-before-speaking.md', markers: scanChapter(ch1Text, entries) },
    { file: 'chapters/02-finding-your-network.md', markers: scanChapter(ch2Text, entries) },
  ];

  const { coveragePct, openClaims } = computeCoverage(chapters, entries);
  assert.equal(openClaims, 0, 'the unmarked sentence is invisible to the engine');
  assert.equal(coveragePct, 100.0, 'coverage is 100% because all present markers resolve');
});

// ---- JSON shape from computeCoverage -----------------------------------------

test('computeCoverage returns all required fields with correct types', () => {
  const result = computeCoverage([{ file: 'chapters/empty.md', markers: [] }], []);
  assert.ok(typeof result.coveragePct === 'number', 'coveragePct is a number');
  assert.ok(typeof result.openClaims === 'number', 'openClaims is a number');
  assert.ok(Array.isArray(result.findings), 'findings is an array');
  assert.ok(typeof result.totalMarkers === 'number', 'totalMarkers is a number');
  assert.ok(typeof result.resolvedCount === 'number', 'resolvedCount is a number');
  assert.ok(Array.isArray(result.chapters), 'chapters is an array');
});

test('computeCoverage chapter summary includes file, totalMarkers, resolvedCount, openClaims, coveragePct', () => {
  const result = computeCoverage([{ file: 'chapters/ch.md', markers: [] }], []);
  assert.equal(result.chapters.length, 1);
  const s = result.chapters[0];
  assert.equal(s.file, 'chapters/ch.md');
  assert.ok(Object.prototype.hasOwnProperty.call(s, 'totalMarkers'), 'has totalMarkers');
  assert.ok(Object.prototype.hasOwnProperty.call(s, 'resolvedCount'), 'has resolvedCount');
  assert.ok(Object.prototype.hasOwnProperty.call(s, 'openClaims'), 'has openClaims');
  assert.ok(Object.prototype.hasOwnProperty.call(s, 'coveragePct'), 'has coveragePct');
});
