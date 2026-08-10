// tests/engines/apparatus.test.mjs
// what-it-is:   unit tests for hooks/lib/apparatus-engine.mjs
// what-it-does: verifies the Chicago-style helper functions (short-title derivation, author
//               name reordering), resolveSource's four-way source-eligibility verdict, the
//               computeApparatus orchestrator (full/short form alternation and its per-chapter
//               reset, bibliography dedup and uncited-source exclusion, deterministic sort
//               order independent of ledger/citation order, all six attention triggers, and
//               the "no malformed note" guarantee), the four markdown builders, and
//               engine-level byte-identical regeneration
// runner:       node --test tests/engines/apparatus.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  shortTitle, authorSurname, authorSurnames, authorFullForm,
  resolveSource, renderBibliographyEntry, computeApparatus,
  buildEndnotesMarkdown, buildBibliographyMarkdown,
  buildIndexCandidatesMarkdown, buildAttentionMarkdown,
} from '../../hooks/lib/apparatus-engine.mjs';
import { parseEvidenceLog, parseSources } from '../../hooks/lib/ledger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES = join(__dirname, 'fixtures', 'apparatus');
const STYLE_PATH = join(__dirname, '..', '..', 'hooks', 'lib', 'citation-styles', 'chicago.json');

function readFixture(name) {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function loadStyle() {
  return JSON.parse(readFileSync(STYLE_PATH, 'utf8'));
}

// ---- shared fixture loaders ------------------------------------------------------

function loadHappy() {
  const ledgerEntries = parseEvidenceLog(readFixture('happy-ledger.md'));
  const sourceEntries = parseSources(readFixture('happy-sources.md'));
  const chapters = [
    { file: 'chapters/one.md', text: readFixture('happy-chapter-one.md') },
    { file: 'chapters/two.md', text: readFixture('happy-chapter-two.md') },
  ];
  return { ledgerEntries, sourceEntries, chapters, style: loadStyle() };
}

function loadAttention() {
  const ledgerEntries = parseEvidenceLog(readFixture('attention-ledger.md'));
  const sourceEntries = parseSources(readFixture('attention-sources.md'));
  const chapters = [
    { file: 'chapters/attention.md', text: readFixture('attention-chapter.md') },
  ];
  return { ledgerEntries, sourceEntries, chapters, style: loadStyle() };
}

// ==== shortTitle =====================================================================

test('shortTitle: truncates at the first colon and trims', () => {
  assert.equal(
    shortTitle('The New Learning Architect: Building Learning Into the Workflow of Business'),
    'New Learning Architect'
  );
});

test('shortTitle: strips a leading "The", "A", or "An"', () => {
  assert.equal(shortTitle('The Strength of Weak Ties'), 'Strength of Weak Ties');
  assert.equal(shortTitle('A Field Guide to Attention'), 'Field Guide to Attention');
  assert.equal(shortTitle('An Honest Account'), 'Honest Account');
});

test('shortTitle: a title with no colon and no leading article is unchanged', () => {
  assert.equal(
    shortTitle('Neocortex size as a constraint on group size in primates'),
    'Neocortex size as a constraint on group size in primates'
  );
});

test('shortTitle: is a pure function of the title text (same input, same output)', () => {
  const title = 'Situated Learning: Legitimate Peripheral Participation';
  assert.equal(shortTitle(title), shortTitle(title));
});

// ==== authorSurname / authorSurnames / authorFullForm ================================

test('authorSurname: single author "Surname, First"', () => {
  assert.equal(authorSurname('Hart, Jane'), 'Hart');
});

test('authorSurname: takes the FIRST author of an "and"-joined multi-author field', () => {
  assert.equal(authorSurname('Lave, Jean and Wenger, Etienne'), 'Lave');
});

test('authorSurnames: returns every author surname in a multi-author field', () => {
  assert.deepEqual(authorSurnames('Lave, Jean and Wenger, Etienne'), ['Lave', 'Wenger']);
});

test('authorFullForm: reorders "Surname, First" to "First Surname"', () => {
  assert.equal(authorFullForm('Hart, Jane'), 'Jane Hart');
});

test('authorFullForm: handles a middle-initial-heavy name', () => {
  assert.equal(authorFullForm('Dunbar, R. I. M.'), 'R. I. M. Dunbar');
});

test('authorFullForm: reorders each segment of an "and"-joined multi-author field independently', () => {
  assert.equal(authorFullForm('Lave, Jean and Wenger, Etienne'), 'Jean Lave and Etienne Wenger');
});

// ==== resolveSource ====================================================================

test('resolveSource: a complete, known-type source resolves ok', () => {
  const sourceEntries = parseSources(readFixture('attention-sources.md'));
  const sourceMap = new Map(sourceEntries.map((e) => [e.id, e]));
  const style = loadStyle();
  const result = resolveSource('SRC-0001', sourceMap, style);
  assert.equal(result.ok, true);
  assert.equal(result.srcId, 'SRC-0001');
  assert.equal(result.type, 'book');
});

test('resolveSource: a blank source id is missing-source', () => {
  const sourceMap = new Map();
  const result = resolveSource('', sourceMap, loadStyle());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-source');
  assert.equal(result.srcId, null);
});

test('resolveSource: a source id absent from sources.md is missing-source', () => {
  const sourceMap = new Map();
  const result = resolveSource('SRC-9999', sourceMap, loadStyle());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-source');
  assert.equal(result.srcId, 'SRC-9999');
});

test('resolveSource: an unrecognized type is unknown-source-type', () => {
  const sourceEntries = parseSources(readFixture('attention-sources.md'));
  const sourceMap = new Map(sourceEntries.map((e) => [e.id, e]));
  const result = resolveSource('SRC-0003', sourceMap, loadStyle());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown-source-type');
  assert.equal(result.srcType, 'interview');
});

test('renderBibliographyEntry: an author ending in a period-terminated initial does not double the period (regression, found against the real sample book: "Dunbar, R. I. M." rendered as "Dunbar, R. I. M.." before the fix)', () => {
  const style = loadStyle();
  const sourceMap = new Map([
    ['SRC-0001', {
      id: 'SRC-0001', type: 'article', author: 'Doe, John Q.',
      title: 'A Study With An Abbreviated Author Name', year: 2020,
      publisher: 'Journal of Examples', identifier: '', url: '', accessed: '',
    }],
  ]);
  const resolved = resolveSource('SRC-0001', sourceMap, style);
  assert.equal(resolved.ok, true);
  const text = renderBibliographyEntry(resolved);
  assert.doesNotMatch(text, /\.\./, 'no two consecutive periods anywhere in the entry; got: ' + text);
  assert.match(text, /^Doe, John Q\. "A Study/, 'exactly one period between the abbreviation and the title; got: ' + text);
});

test('resolveSource: a source missing a type-required field is incomplete-source', () => {
  const sourceEntries = parseSources(readFixture('attention-sources.md'));
  const sourceMap = new Map(sourceEntries.map((e) => [e.id, e]));
  const result = resolveSource('SRC-0002', sourceMap, loadStyle());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'incomplete-source');
  assert.ok(result.missingFields.includes('url'), 'names url as the missing field; got: ' + JSON.stringify(result.missingFields));
});

// ==== computeApparatus: happy-path notes, forms, bibliography, ordering ==============

test('computeApparatus: every EV entry with a valid locator and source produces one note', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const totalNotes = result.chapters.reduce((n, c) => n + c.notes.length, 0);
  assert.equal(totalNotes, 6, 'six EV entries, six notes');
  assert.equal(result.attention.length, 0, 'no attention rows on the happy path');
});

test('computeApparatus: first citation of a source in a chapter is full form, a repeat is short form', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const chapterOne = result.chapters.find((c) => c.file === 'chapters/one.md');
  assert.equal(chapterOne.notes.length, 5);

  // Note 2 (EV-0002, first SRC-0002 citation in chapter one): full form names publisher and year.
  assert.match(chapterOne.notes[1].text, /Fictional Press/, 'first citation is full form; got: ' + chapterOne.notes[1].text);
  assert.match(chapterOne.notes[1].text, /2018/);

  // Note 5 (EV-0005, second SRC-0002 citation in the SAME chapter): short form omits publisher/year.
  const shortNote = chapterOne.notes[4].text;
  assert.doesNotMatch(shortNote, /Fictional Press/, 'repeat citation is short form; got: ' + shortNote);
  assert.doesNotMatch(shortNote, /2018/);
  assert.match(shortNote, /^Baker,/, 'short form opens with the author surname; got: ' + shortNote);
  assert.match(shortNote, /p\. 45/, 'short form still carries this citation\'s own locator');
});

test('computeApparatus: full/short state resets per chapter, not per book', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const chapterTwo = result.chapters.find((c) => c.file === 'chapters/two.md');
  assert.equal(chapterTwo.notes.length, 1);
  // EV-0006 is the third citation of SRC-0002 book-wide, but the first within chapter two,
  // so it must render full form again (publisher and year present), not short form.
  assert.match(chapterTwo.notes[0].text, /Fictional Press/, 'first-in-chapter-two citation is full form; got: ' + chapterTwo.notes[0].text);
  assert.match(chapterTwo.notes[0].text, /2018/);
});

test('computeApparatus: note numbers are contiguous starting at 1 within each chapter', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  for (const chapter of result.chapters) {
    chapter.notes.forEach((note, i) => assert.equal(note.number, i + 1));
  }
});

test('computeApparatus: a source cited from three EV entries across two chapters appears in the bibliography exactly once', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const hits = result.bibliography.filter((b) => b.srcId === 'SRC-0002');
  assert.equal(hits.length, 1, 'SRC-0002 (cited by EV-0002, EV-0005, and EV-0006) appears exactly once');
});

test('computeApparatus: a source cited by no EV entry is absent from the bibliography', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  assert.equal(result.bibliography.some((b) => b.srcId === 'SRC-0005'), false, 'SRC-0005 is never cited');
  assert.equal(result.bibliography.length, 4, 'exactly the four cited sources');
});

test('computeApparatus: bibliography is sorted by author surname, independent of ledger or citation order', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const surnames = result.bibliography.map((b) => authorSurname(
    sourceEntries.find((s) => s.id === b.srcId).author
  ));
  // Citation order in the fixture chapters is Ortiz, Baker, Zhang, Nguyen (chapter one) --
  // none of which is alphabetical. The sorted output must be Baker, Nguyen, Ortiz, Zhang.
  assert.deepEqual(surnames, ['Baker', 'Nguyen', 'Ortiz', 'Zhang']);
});

test('computeApparatus: sort order does not depend on ledger entry insertion order', () => {
  const { sourceEntries, chapters, style } = loadHappy();
  const forward = parseEvidenceLog(readFixture('happy-ledger.md'));
  const reversed = [...forward].reverse();
  const resultForward = computeApparatus(chapters, forward, sourceEntries, style);
  const resultReversed = computeApparatus(chapters, reversed, sourceEntries, style);
  assert.deepEqual(
    resultForward.bibliography.map((b) => b.srcId),
    resultReversed.bibliography.map((b) => b.srcId),
    'bibliography order is identical regardless of ledger array order'
  );
});

// ==== computeApparatus: attention triggers and the "no malformed note" guarantee ====

test('computeApparatus: a blank locator lands in attention and produces no note (both halves)', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadAttention();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);

  // Half 1: the attention row exists, names EV-0001, the chapter, and the reason.
  const row = result.attention.find((a) => a.evId === 'EV-0001');
  assert.ok(row, 'EV-0001 has an attention row');
  assert.equal(row.type, 'missing-locator');
  assert.equal(row.chapter, 'chapters/attention.md');
  assert.ok(row.line > 0);
  assert.match(row.reason, /EV-0001/);
  assert.match(row.reason, /locator/);

  // Half 2: no note anywhere in the output traces back to EV-0001. The only chapter in this
  // fixture produces exactly one note total (EV-0002, the control case); if EV-0001 had
  // leaked a malformed or empty note, this count would be wrong.
  const allNotes = result.chapters.flatMap((c) => c.notes);
  assert.equal(allNotes.length, 1, 'exactly one note total: the control case, EV-0002');
  assert.match(allNotes[0].text, /Fine/, 'the one note present is the control case; got: ' + allNotes[0].text);
});

test('computeApparatus: an EV entry naming a nonexistent source lands in attention', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadAttention();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const row = result.attention.find((a) => a.evId === 'EV-0003');
  assert.ok(row);
  assert.equal(row.type, 'missing-source');
  assert.match(row.reason, /SRC-9999/);
});

test('computeApparatus: an EV entry with a blank source field lands in attention', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadAttention();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const row = result.attention.find((a) => a.evId === 'EV-0004');
  assert.ok(row);
  assert.equal(row.type, 'missing-source');
});

test('computeApparatus: a source missing a type-required field lands in attention, naming the field', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadAttention();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const row = result.attention.find((a) => a.evId === 'EV-0005');
  assert.ok(row);
  assert.equal(row.type, 'incomplete-source');
  assert.match(row.reason, /url/);
});

test('computeApparatus: an unknown source type lands in attention rather than crashing', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadAttention();
  assert.doesNotThrow(() => computeApparatus(chapters, ledgerEntries, sourceEntries, style));
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const row = result.attention.find((a) => a.evId === 'EV-0006');
  assert.ok(row);
  assert.equal(row.type, 'unknown-source-type');
  assert.match(row.reason, /interview/);
});

test('computeApparatus: a chapter anchor referencing an EV ID absent from the ledger lands in attention', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadAttention();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const row = result.attention.find((a) => a.evId === 'EV-0099');
  assert.ok(row);
  assert.equal(row.type, 'missing-evidence');
  assert.equal(row.srcId, null);
});

test('computeApparatus: six independent problems in one chapter produce six independent attention rows, none masking another', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadAttention();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const ids = result.attention.map((a) => a.evId).sort();
  assert.deepEqual(ids, ['EV-0001', 'EV-0003', 'EV-0004', 'EV-0005', 'EV-0006', 'EV-0099']);
});

// ==== exit-code-relevant emptiness (CLI maps this to EXIT_CLEAN / EXIT_FINDINGS) ====

test('computeApparatus: attention is empty on a fully clean ledger (the exit-0 precondition)', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  assert.equal(result.attention.length, 0);
});

test('computeApparatus: attention is non-empty when any trigger fires (the exit-1 precondition)', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadAttention();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  assert.ok(result.attention.length > 0);
});

// ==== markdown builders ================================================================

test('buildEndnotesMarkdown: includes a heading per chapter and the correctly numbered notes', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const md = buildEndnotesMarkdown(result);
  assert.match(md, /## Chapter One: Reading and Habits/);
  assert.match(md, /## Chapter Two: Habits Revisited/);
  assert.match(md, /1\. .*p\. 10/);
});

test('buildEndnotesMarkdown: an attention-routed EV never appears as a note, malformed or otherwise', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadAttention();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const md = buildEndnotesMarkdown(result);
  for (const id of ['EV-0001', 'EV-0003', 'EV-0004', 'EV-0005', 'EV-0006', 'EV-0099']) {
    assert.doesNotMatch(md, new RegExp(id), id + ' does not appear anywhere in endnotes.md');
  }
  // Exactly one numbered note (the control case) proves no gap or placeholder was left behind.
  const numbered = md.match(/^\d+\. /gm) || [];
  assert.equal(numbered.length, 1);
});

test('computeApparatus and buildEndnotesMarkdown: a chapter with zero [claim: EV-nnnn] anchors still gets a heading and an explicit "no endnotes" line, never an empty gap', () => {
  const { ledgerEntries, sourceEntries, style } = loadHappy();
  const chapters = [
    { file: 'chapters/empty.md', text: '# Chapter Three: Not Yet Drafted\n\nOutline only, no citations yet.\n' },
  ];
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  assert.equal(result.chapters.length, 1);
  assert.equal(result.chapters[0].notes.length, 0);
  assert.equal(result.chapters[0].heading, 'Chapter Three: Not Yet Drafted');

  const md = buildEndnotesMarkdown(result);
  assert.match(md, /## Chapter Three: Not Yet Drafted/);
  assert.match(md, /No endnotes for this chapter\./);
});

test('computeApparatus: a chapter with no H1 heading falls back to its filename slug', () => {
  const { ledgerEntries, sourceEntries, style } = loadHappy();
  const chapters = [
    { file: 'chapters/03-no-heading.md', text: 'No heading line at all in this chapter file.\n' },
  ];
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  assert.equal(result.chapters[0].heading, '03-no-heading');
});

test('buildBibliographyMarkdown: lists every cited source exactly once and omits the uncited one', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const md = buildBibliographyMarkdown(result);
  assert.equal((md.match(/Baker, Tom/g) || []).length, 1);
  assert.doesNotMatch(md, /Uncited, Sam/);
});

test('buildIndexCandidatesMarkdown: documents the derivation rule and lists chapters per term', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const md = buildIndexCandidatesMarkdown(result);
  assert.match(md, /candidate/i);
  assert.match(md, /Baker/);
});

test('buildAttentionMarkdown: names the ID, the chapter, and the issue for every row', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadAttention();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const md = buildAttentionMarkdown(result);
  assert.match(md, /EV-0001/);
  assert.match(md, /Chapter: Attention Cases/, 'names the chapter by its derived heading, matching endnotes.md');
  assert.match(md, /locator/);
});

test('buildAttentionMarkdown: an empty attention list still produces a well-formed, non-table file', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const md = buildAttentionMarkdown(result);
  assert.doesNotMatch(md, /\|---\|/, 'no empty table when there is nothing to report');
});

// ==== byte-identical regeneration (engine level) =======================================

test('byte-identical regeneration: computing and rendering twice over the same input yields identical strings', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const first = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const second = computeApparatus(chapters, ledgerEntries, sourceEntries, style);

  assert.equal(buildEndnotesMarkdown(first), buildEndnotesMarkdown(second));
  assert.equal(buildBibliographyMarkdown(first), buildBibliographyMarkdown(second));
  assert.equal(buildIndexCandidatesMarkdown(first), buildIndexCandidatesMarkdown(second));
  assert.equal(buildAttentionMarkdown(first), buildAttentionMarkdown(second));
});

test('generated markdown never contains a generation timestamp', () => {
  const { ledgerEntries, sourceEntries, chapters, style } = loadHappy();
  const result = computeApparatus(chapters, ledgerEntries, sourceEntries, style);
  const all = [
    buildEndnotesMarkdown(result), buildBibliographyMarkdown(result),
    buildIndexCandidatesMarkdown(result), buildAttentionMarkdown(result),
  ].join('\n');
  // An ISO-8601 timestamp (the shape new Date().toISOString() produces) would be the
  // concrete failure mode that breaks byte-identical regeneration across two real clock
  // ticks; its absence here is the direct proof, not an inference from the test above.
  assert.doesNotMatch(all, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});
