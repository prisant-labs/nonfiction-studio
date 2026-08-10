// tests/engines/quotes.test.mjs
// what-it-is:   unit tests for the quote-fidelity engine additions to hooks/lib/claims-engine.mjs
// what-it-does: verifies scanQuoteAnchors, computeQuoteFindings, and buildResearchPacket against
//               the OPP-D03 (quote fidelity and source packets) required cases: exact match, the
//               planted-altered-word headline case, missing-entry / no-excerpt / no-span anchors,
//               no normalization, and deterministic packet generation with a visible missing locator
// runner:       node --test tests/engines/quotes.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanQuoteAnchors, computeQuoteFindings, buildResearchPacket } from '../../hooks/lib/claims-engine.mjs';
import { parseEvidenceLog } from '../../hooks/lib/ledger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, 'fixtures', 'claims');

function readFixture(name) {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// ---- case 3: matching quoted span produces no finding --------------------------

test('quote match: exact quoted span produces no finding', () => {
  const entries = parseEvidenceLog(readFixture('quote-match-ledger.md'));
  const anchors = scanQuoteAnchors(readFixture('quote-match.md'), entries);

  assert.equal(anchors.length, 1, 'one quote anchor found');
  assert.equal(anchors[0].status, 'ok', 'exact match status is ok');
  assert.equal(anchors[0].diff, null, 'no diff on an exact match');

  const { findings } = computeQuoteFindings([{ file: 'chapters/quote-match.md', anchors }]);
  assert.equal(findings.length, 0, 'no findings for an exact match');
});

// ---- case 4: the planted altered word (headline acceptance case) ---------------

test('quote altered word: mismatch finding diff shows the changed word, with a line number (case 4)', () => {
  const entries = parseEvidenceLog(readFixture('quote-altered-word-ledger.md'));
  const text = readFixture('quote-altered-word.md');
  const anchors = scanQuoteAnchors(text, entries);

  assert.equal(anchors.length, 1, 'one quote anchor found');
  assert.equal(anchors[0].status, 'mismatch', 'one altered word is a mismatch');
  assert.ok(anchors[0].diff.includes('session'), 'diff names the original word "session"; got: ' + anchors[0].diff);
  assert.ok(anchors[0].diff.includes('exam'), 'diff names the altered word "exam"; got: ' + anchors[0].diff);
  assert.ok(typeof anchors[0].line === 'number' && anchors[0].line > 0, 'line is a positive integer');

  const { findings } = computeQuoteFindings([{ file: 'chapters/quote-altered-word.md', anchors }]);
  assert.equal(findings.length, 1, 'exactly one finding');
  assert.equal(findings[0].type, 'quote_fidelity.mismatch', 'finding type names the mismatch kind');
  assert.equal(findings[0].line, anchors[0].line, 'finding line matches the anchor line');
  assert.ok(findings[0].detail.includes('session') && findings[0].detail.includes('exam'),
    'finding detail carries the diff; got: ' + findings[0].detail);
});

// ---- no normalization: a typographic difference is a mismatch, never silently accepted ----

test('no normalization: a curly apostrophe inside the span differs from a straight one in verbatim (mismatch, not normalized)', () => {
  const ledgerText = [
    '### EV-0001 (typographic difference)',
    '- claim: The source uses a straight apostrophe in the original.',
    '- source: SRC-0001',
    '- locator:',
    '- confidence: high',
    '- status: verified',
    '- added-by: research-librarian',
    '- date: 2026-07-18',
    "- verbatim: The author's original point stands.",
  ].join('\n');
  const entries = parseEvidenceLog(ledgerText);
  // Curly apostrophe (U+2019) inside the quoted span; straight double quotes bound the span
  // itself, per the marker rule. This is exactly the mismatch class the deferred normalization
  // policy has to adjudicate (roadmap row 1.5); this check must never paper over it.
  const text = 'The chapter quotes it as: "The author’s original point stands." [quote: EV-0001]\n';
  const anchors = scanQuoteAnchors(text, entries);

  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].status, 'mismatch',
    'a curly apostrophe inside the span is not normalized away; it must mismatch');
});

// ---- case 5: anchor references a missing ledger entry --------------------------

test('quote missing entry: anchor referencing an absent EV ID produces the missing-entry finding (case 5)', () => {
  const entries = parseEvidenceLog(readFixture('quote-missing-entry-ledger.md'));
  const anchors = scanQuoteAnchors(readFixture('quote-missing-entry.md'), entries);

  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].status, 'missing-entry');
  assert.equal(anchors[0].id, 'EV-9999');
  assert.ok(anchors[0].reason.includes('EV-9999'), 'reason names the missing ID');
});

// ---- case 6: entry has no verbatim field ----------------------------------------

test('quote no excerpt: anchor referencing an entry with no verbatim field produces the no-excerpt finding (case 6)', () => {
  const entries = parseEvidenceLog(readFixture('quote-no-excerpt-ledger.md'));
  const anchors = scanQuoteAnchors(readFixture('quote-no-excerpt.md'), entries);

  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].status, 'no-excerpt');
  assert.equal(anchors[0].id, 'EV-0001');
  assert.ok(anchors[0].reason.includes('EV-0001'), 'reason names the ID');
});

// ---- case 7: no quoted span precedes the anchor --------------------------------

test('quote no span: anchor with no preceding quoted span produces the no-span finding, naming id and line (case 7)', () => {
  const entries = parseEvidenceLog(readFixture('quote-no-span-ledger.md'));
  const anchors = scanQuoteAnchors(readFixture('quote-no-span.md'), entries);

  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].status, 'no-span');
  assert.equal(anchors[0].id, 'EV-0001');
  assert.ok(anchors[0].reason.includes('EV-0001'), 'reason names the ID');
  assert.ok(typeof anchors[0].line === 'number' && anchors[0].line > 0, 'line is a positive integer');
  assert.ok(anchors[0].reason.includes(String(anchors[0].line)), 'reason names the line number');
});

// ---- placement rule: sentence-terminal punctuation is allowed in the gap -------

test('placement rule: sentence-terminal punctuation between the closing quote and the anchor is part of the gap, not the span', () => {
  const ledgerText = [
    '### EV-0001 (terminal punctuation)',
    '- claim: A claim quoted with terminal punctuation before the anchor.',
    '- source: SRC-0001',
    '- locator:',
    '- confidence: high',
    '- status: verified',
    '- added-by: research-librarian',
    '- date: 2026-07-18',
    '- verbatim: Exactly this sentence',
  ].join('\n');
  const entries = parseEvidenceLog(ledgerText);
  // The period sits INSIDE the closing quote here, so it is part of the extracted span,
  // not the gap; the stored verbatim (without a trailing period) must therefore mismatch.
  // This proves the gap rule governs what is BETWEEN the quote and the anchor, not what the
  // quoted text itself contains.
  const text = 'She wrote: "Exactly this sentence." [quote: EV-0001]\n';
  const anchors = scanQuoteAnchors(text, entries);

  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].status, 'mismatch');
});

test('placement rule: whitespace-only gap (no terminal punctuation) is also valid', () => {
  const ledgerText = [
    '### EV-0001 (whitespace only gap)',
    '- claim: A claim quoted with only whitespace before the anchor.',
    '- source: SRC-0001',
    '- locator:',
    '- confidence: high',
    '- status: verified',
    '- added-by: research-librarian',
    '- date: 2026-07-18',
    '- verbatim: Exactly this sentence',
  ].join('\n');
  const entries = parseEvidenceLog(ledgerText);
  const text = 'She wrote: "Exactly this sentence" [quote: EV-0001]\n';
  const anchors = scanQuoteAnchors(text, entries);

  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].status, 'ok', 'whitespace-only gap with an exact match is not a finding');
});

// ---- case 11 (unit level): buildResearchPacket is a pure, deterministic function ----

test('packet determinism: calling buildResearchPacket twice with the same inputs is byte-identical (case 11)', () => {
  const entries = parseEvidenceLog(readFixture('quote-packet-ledger.md'));
  const text = readFixture('quote-packet-chapter.md');
  const anchors = scanQuoteAnchors(text, entries);

  const first = buildResearchPacket('quote-packet-chapter', anchors);
  const second = buildResearchPacket('quote-packet-chapter', anchors);
  assert.equal(first, second, 'two calls with unchanged inputs produce byte-identical output');
});

test('packet: no generation timestamp is stamped into the content', () => {
  const entries = parseEvidenceLog(readFixture('quote-packet-ledger.md'));
  const anchors = scanQuoteAnchors(readFixture('quote-packet-chapter.md'), entries);
  const packet = buildResearchPacket('quote-packet-chapter', anchors);
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(packet), 'packet body carries no generation timestamp');
});

// ---- case 12: a blank locator is visible in the packet, not silently omitted ----

test('packet: EV entry with a blank locator appears with its missing locator visible (case 12)', () => {
  const entries = parseEvidenceLog(readFixture('quote-packet-ledger.md'));
  const anchors = scanQuoteAnchors(readFixture('quote-packet-chapter.md'), entries);
  const packet = buildResearchPacket('quote-packet-chapter', anchors);

  assert.ok(packet.includes('EV-0002'), 'packet lists the blank-locator entry EV-0002');
  assert.ok(packet.includes('missing locator'),
    'packet visibly flags the missing locator rather than omitting it; got: ' + packet);

  // The complete entry (EV-0001, which HAS a locator) shows its real locator value.
  const ev1Idx = packet.indexOf('EV-0001');
  const ev2Idx = packet.indexOf('EV-0002');
  const ev1Section = packet.slice(ev1Idx, ev2Idx);
  assert.ok(ev1Section.includes('p. 21'), 'EV-0001 shows its real locator value; got section: ' + ev1Section);
});

// ---- packet: every anchor's verbatim excerpt is present ------------------------

test('packet: each quote anchor carries its EV id, handle, claim, source, and verbatim excerpt', () => {
  const entries = parseEvidenceLog(readFixture('quote-packet-ledger.md'));
  const anchors = scanQuoteAnchors(readFixture('quote-packet-chapter.md'), entries);
  const packet = buildResearchPacket('quote-packet-chapter', anchors);

  assert.ok(packet.includes('EV-0001'), 'packet names EV-0001');
  assert.ok(packet.includes('packet complete entry'), 'packet names the EV-0001 handle');
  assert.ok(packet.includes('A fully sourced claim with every field present.'), 'packet includes the claim text');
  assert.ok(packet.includes('SRC-0001'), 'packet names the source id');
  assert.ok(packet.includes('Every field on this entry is present and complete.'), 'packet includes the verbatim excerpt');
});

// ---- packet: zero anchors still produces deterministic, explicit output --------

test('packet: a chapter with zero quote anchors still produces a deterministic, explicit packet', () => {
  const packet1 = buildResearchPacket('no-anchors-chapter', []);
  const packet2 = buildResearchPacket('no-anchors-chapter', []);
  assert.equal(packet1, packet2, 'zero-anchor packets are byte-identical across calls');
  assert.ok(/no.*quote.*anchor/i.test(packet1), 'packet says plainly that no quote anchors were found');
});
