// tests/lib/ledger.test.mjs
// what-it-is:   unit tests for hooks/lib/ledger.mjs
// what-it-does: verifies parseEvidenceLog, serializeEvidenceLog, parseSources, serializeSources,
//               and resolvedStatuses; the key invariant is byte-faithful round-trip with unknown fields
// runner:       node --test tests/lib/ledger.test.mjs (or node --test tests/lib/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import {
  resolvedStatuses,
  parseEvidenceLog,
  serializeEvidenceLog,
  parseSources,
  serializeSources,
} from '../../hooks/lib/ledger.mjs';

// ---- resolvedStatuses ----------------------------------------------------------

test('resolvedStatuses is a Set containing exactly verified and interpretation', () => {
  assert.ok(resolvedStatuses instanceof Set, 'resolvedStatuses is a Set');
  assert.ok(resolvedStatuses.has('verified'), 'contains verified');
  assert.ok(resolvedStatuses.has('interpretation'), 'contains interpretation');
  assert.equal(resolvedStatuses.size, 2, 'contains exactly two values');
});

test('resolvedStatuses does not contain pending, unverified, or source-unverifiable', () => {
  assert.ok(!resolvedStatuses.has('pending'), 'pending is not resolved');
  assert.ok(!resolvedStatuses.has('unverified'), 'unverified is not resolved');
  assert.ok(!resolvedStatuses.has('source-unverifiable'), 'source-unverifiable is not resolved');
});

// ---- inline fixtures for ledger round-trip -------------------------------------

// A minimal EV entry with a custom unknown field for the round-trip test.
const EV_FIXTURE_SINGLE = [
  '### EV-0001 (test entry)',
  '- claim: Spaced repetition raises recall.',
  '- source: SRC-0001',
  '- locator: pp. 1-3',
  '- confidence: high',
  '- status: verified',
  '- added-by: research-librarian',
  '- date: 2026-07-18',
  '- custom-field: kept',
].join('\n');

// Two EV entries for multi-entry parsing test.
const EV_FIXTURE_TWO = [
  '### EV-0001 (entry one)',
  '- claim: First claim.',
  '- source: SRC-0001',
  '- locator:',
  '- confidence: high',
  '- status: verified',
  '- added-by: research-librarian',
  '- date: 2026-07-18',
  '',
  '### EV-0002 (entry two)',
  '- claim: Second claim.',
  '- source: none',
  '- locator:',
  '- confidence: low',
  '- status: pending',
  '- added-by: research-librarian',
  '- date: 2026-07-18',
].join('\n');

// A minimal SRC entry with a custom unknown field.
const SRC_FIXTURE_SINGLE = [
  '### SRC-0001 (Test Book)',
  '- type: book',
  '- nature: secondary',
  '- author: Test, Author',
  '- title: The Test Book',
  '- year: 2024',
  '- publisher: Test Press',
  '- identifier:',
  '- url:',
  '- accessed:',
  '- retrieval-status: stable',
  '- custom-field: kept',
].join('\n');

// ---- parseEvidenceLog: basic parsing -------------------------------------------

test('parseEvidenceLog returns an array of entries', () => {
  const entries = parseEvidenceLog(EV_FIXTURE_SINGLE);
  assert.ok(Array.isArray(entries), 'result is an array');
  assert.equal(entries.length, 1, 'one entry parsed');
});

test('parseEvidenceLog parses id and handle from the heading', () => {
  const entries = parseEvidenceLog(EV_FIXTURE_SINGLE);
  assert.equal(entries[0].id, 'EV-0001');
  assert.equal(entries[0].handle, 'test entry');
});

test('parseEvidenceLog parses all seven known fields', () => {
  const entries = parseEvidenceLog(EV_FIXTURE_SINGLE);
  const e = entries[0];
  assert.equal(e.claim, 'Spaced repetition raises recall.');
  assert.equal(e.source, 'SRC-0001');
  assert.equal(e.locator, 'pp. 1-3');
  assert.equal(e.confidence, 'high');
  assert.equal(e.status, 'verified');
  assert.equal(e['added-by'], 'research-librarian');
  assert.equal(e.date, '2026-07-18');
});

test('parseEvidenceLog puts unknown field into extra map', () => {
  const entries = parseEvidenceLog(EV_FIXTURE_SINGLE);
  assert.ok(entries[0].extra, 'extra map exists');
  assert.equal(entries[0].extra['custom-field'], 'kept', 'unknown field is in extra');
  assert.ok(!Object.prototype.hasOwnProperty.call(entries[0], 'custom-field'),
    'unknown field is not on the entry object directly');
});

test('parseEvidenceLog parses two entries from two-entry text', () => {
  const entries = parseEvidenceLog(EV_FIXTURE_TWO);
  assert.equal(entries.length, 2, 'two entries parsed');
  assert.equal(entries[0].id, 'EV-0001');
  assert.equal(entries[1].id, 'EV-0002');
  assert.equal(entries[1].status, 'pending');
});

test('parseEvidenceLog handles empty locator field', () => {
  const entries = parseEvidenceLog(EV_FIXTURE_TWO);
  assert.equal(entries[0].locator, '', 'empty locator is stored as empty string');
});

test('parseEvidenceLog ignores preamble lines (HTML comment, headings)', () => {
  const withPreamble = [
    '<!-- some comment -->',
    '',
    '# Evidence Log',
    '',
    '### EV-0001 (entry)',
    '- claim: Test.',
    '- source: none',
    '- locator:',
    '- confidence: low',
    '- status: pending',
    '- added-by: research-librarian',
    '- date: 2026-07-18',
  ].join('\n');
  const entries = parseEvidenceLog(withPreamble);
  assert.equal(entries.length, 1, 'preamble lines are skipped; one entry parsed');
  assert.equal(entries[0].id, 'EV-0001');
});

// ---- round-trip: byte-faithful for evidence log --------------------------------

test('serializeEvidenceLog round-trips a single entry byte-faithfully', () => {
  const entries = parseEvidenceLog(EV_FIXTURE_SINGLE);
  const serialized = serializeEvidenceLog(entries);
  assert.equal(serialized, EV_FIXTURE_SINGLE,
    'serialized output is byte-for-byte identical to the parsed input');
});

test('serializeEvidenceLog round-trips preserves unknown field (custom-field: kept)', () => {
  const entries = parseEvidenceLog(EV_FIXTURE_SINGLE);
  const serialized = serializeEvidenceLog(entries);
  assert.ok(serialized.includes('- custom-field: kept'), 'unknown field appears in serialized output');
});

test('serializeEvidenceLog round-trips two entries byte-faithfully', () => {
  const entries = parseEvidenceLog(EV_FIXTURE_TWO);
  const serialized = serializeEvidenceLog(entries);
  assert.equal(serialized, EV_FIXTURE_TWO,
    'two-entry serialized output is byte-for-byte identical to the parsed input');
});

test('serializeEvidenceLog reproduces empty locator as "- locator:" (no trailing space)', () => {
  const entries = parseEvidenceLog(EV_FIXTURE_TWO);
  const serialized = serializeEvidenceLog(entries);
  assert.ok(serialized.includes('- locator:\n'), 'empty locator serializes without trailing space');
});

// ---- parseSources: basic parsing -----------------------------------------------

test('parseSources returns an array of entries', () => {
  const entries = parseSources(SRC_FIXTURE_SINGLE);
  assert.ok(Array.isArray(entries), 'result is an array');
  assert.equal(entries.length, 1, 'one entry parsed');
});

test('parseSources parses id and handle from the heading', () => {
  const entries = parseSources(SRC_FIXTURE_SINGLE);
  assert.equal(entries[0].id, 'SRC-0001');
  assert.equal(entries[0].handle, 'Test Book');
});

test('parseSources parses all ten known fields', () => {
  const entries = parseSources(SRC_FIXTURE_SINGLE);
  const e = entries[0];
  assert.equal(e.type, 'book');
  assert.equal(e.nature, 'secondary');
  assert.equal(e.author, 'Test, Author');
  assert.equal(e.title, 'The Test Book');
  assert.equal(e.year, 2024, 'year is stored as integer');
  assert.equal(e.publisher, 'Test Press');
  assert.equal(e.identifier, '');
  assert.equal(e.url, '');
  assert.equal(e.accessed, '');
  assert.equal(e['retrieval-status'], 'stable');
});

test('parseSources coerces year to integer', () => {
  const entries = parseSources(SRC_FIXTURE_SINGLE);
  assert.equal(typeof entries[0].year, 'number', 'year is a number');
  assert.equal(entries[0].year, 2024);
});

test('parseSources puts unknown field into extra map', () => {
  const entries = parseSources(SRC_FIXTURE_SINGLE);
  assert.ok(entries[0].extra, 'extra map exists');
  assert.equal(entries[0].extra['custom-field'], 'kept', 'unknown field is in extra');
  assert.ok(!Object.prototype.hasOwnProperty.call(entries[0], 'custom-field'),
    'unknown field is not on the entry object directly');
});

// ---- round-trip: byte-faithful for sources ------------------------------------

test('serializeSources round-trips a single entry byte-faithfully', () => {
  const entries = parseSources(SRC_FIXTURE_SINGLE);
  const serialized = serializeSources(entries);
  assert.equal(serialized, SRC_FIXTURE_SINGLE,
    'serialized output is byte-for-byte identical to the parsed input');
});

test('serializeSources round-trips preserves unknown field (custom-field: kept)', () => {
  const entries = parseSources(SRC_FIXTURE_SINGLE);
  const serialized = serializeSources(entries);
  assert.ok(serialized.includes('- custom-field: kept'), 'unknown field appears in serialized output');
});

// ---- parse against the committed sample book files (read-only) -----------------

test('parseEvidenceLog handles the committed sample book evidence-log.md', () => {
  const samplePath = join(__dirname, '..', '..', 'examples', 'sample-book', 'research', 'evidence-log.md');
  const text = readFileSync(samplePath, 'utf8');
  const entries = parseEvidenceLog(text);
  assert.equal(entries.length, 10, 'ten EV entries in the sample book');
  assert.equal(entries[0].id, 'EV-0001');
  assert.equal(entries[9].id, 'EV-0010');
  // Spot-check: EV-0005 has status interpretation, which is a resolvedStatus.
  const ev5 = entries.find(e => e.id === 'EV-0005');
  assert.ok(ev5, 'EV-0005 is present');
  assert.ok(resolvedStatuses.has(ev5.status), 'EV-0005 status (interpretation) is in resolvedStatuses');
});

test('parseSources handles the committed sample book sources.md', () => {
  const samplePath = join(__dirname, '..', '..', 'examples', 'sample-book', 'research', 'sources.md');
  const text = readFileSync(samplePath, 'utf8');
  const entries = parseSources(text);
  assert.equal(entries.length, 6, 'six SRC entries in the sample book (SRC-0006 added per TSK-057 (Phase 1 gate verification) review fixture correction)');
  assert.equal(entries[0].id, 'SRC-0001');
  assert.equal(entries[3].id, 'SRC-0004');
  assert.equal(entries[4].id, 'SRC-0005');
  assert.equal(entries[5].id, 'SRC-0006');
  // Spot-check: year is parsed as integer.
  assert.equal(typeof entries[0].year, 'number', 'year is a number');
  assert.equal(entries[0].year, 2015);
});

// ---- verbatim field (Task 4: quote fidelity and research packets, warn mode) ---
// D-07 (claim ledger with stable IDs) amendment: verbatim is an OPTIONAL, named,
// validated EV field holding the exact source text for quote-fidelity checking.
// An EV entry without it must parse and round-trip exactly as before (case 2).

const EV_FIXTURE_VERBATIM = [
  '### EV-0001 (verbatim field)',
  '- claim: The source is quoted directly in the chapter.',
  '- source: SRC-0001',
  '- locator: p. 8',
  '- verbatim: The exact words as they appear in the source.',
  '- confidence: high',
  '- status: verified',
  '- added-by: research-librarian',
  '- date: 2026-07-18',
].join('\n');

test('parseEvidenceLog parses the optional verbatim field as a named, known field (case 1)', () => {
  const entries = parseEvidenceLog(EV_FIXTURE_VERBATIM);
  assert.equal(entries[0].verbatim, 'The exact words as they appear in the source.');
  assert.ok(!Object.prototype.hasOwnProperty.call(entries[0].extra, 'verbatim'),
    'verbatim is a named field, not routed through the extra map');
});

test('serializeEvidenceLog round-trips an entry with verbatim byte-faithfully, preserving field order (case 1)', () => {
  const entries = parseEvidenceLog(EV_FIXTURE_VERBATIM);
  const serialized = serializeEvidenceLog(entries);
  assert.equal(serialized, EV_FIXTURE_VERBATIM,
    'serialized output is byte-for-byte identical, including the verbatim field position');
});

test('parseEvidenceLog: an EV entry WITHOUT verbatim still parses and behaves exactly as before (case 2)', () => {
  // EV_FIXTURE_SINGLE (defined above) has no verbatim field.
  const entries = parseEvidenceLog(EV_FIXTURE_SINGLE);
  assert.equal(entries[0].verbatim, undefined, 'verbatim is undefined when absent, like any other optional field');
  const serialized = serializeEvidenceLog(entries);
  assert.equal(serialized, EV_FIXTURE_SINGLE, 'entries without verbatim round-trip unchanged (case 2)');
});

// ---- fieldOrder preservation ---------------------------------------------------

test('_fieldOrder captures the original field sequence including unknown fields', () => {
  const entries = parseEvidenceLog(EV_FIXTURE_SINGLE);
  const fieldOrder = entries[0]._fieldOrder;
  assert.ok(Array.isArray(fieldOrder), '_fieldOrder is an array');
  // custom-field should appear after date (it is the last field in the fixture).
  const dateIdx = fieldOrder.indexOf('date');
  const customIdx = fieldOrder.indexOf('custom-field');
  assert.ok(dateIdx !== -1, 'date is in _fieldOrder');
  assert.ok(customIdx !== -1, 'custom-field is in _fieldOrder');
  assert.ok(customIdx > dateIdx, 'custom-field appears after date in the original order');
});
