// tests/engines/overlap.test.mjs
// what-it-is:   unit and CLI-level tests for hooks/lib/overlap-engine.mjs and bin/ns-overlap
// what-it-does: covers the P6 algorithm (normalization table, shingle-merge arithmetic,
//               threshold edges, quoted-span exclusion, corpus discovery, sorted enumeration)
//               at the engine level, and the CLI anatomy (--help, exit taxonomy, --json/human
//               modes, --min-words override, determinism) by spawning the real binary
// runner:       node --test tests/engines/overlap.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

import { findOverlaps, discoverCorpora, SHINGLE_SIZE, DEFAULT_MIN_WORDS } from '../../hooks/lib/overlap-engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_ROOT = join(__dirname, 'fixtures', 'overlap');
const BIN = join(__dirname, '..', '..', 'bin', 'ns-overlap');

// =====================================================================================
// Part 1: normalization table (Step 2) - each case proves one normalization rule by
// making two texts match ONLY if that rule is applied. minWords is lowered to exactly
// SHINGLE_SIZE (8) so a single unchained 8-word shingle is enough to observe a match,
// independent of the default 15-word threshold tested separately below.
// =====================================================================================

test('normalization: a curly apostrophe inside a word is straightened, so it matches a straight one', () => {
  const chapters = [{ file: 'chapters/x.md', text: 'She said orbit signal can' + '\u2019' + 't verify itself without proper context and then left.' }];
  const corpora = [{ source: 'src/a.md', text: 'Reference text: orbit signal can\'t verify itself without proper context here, unchanged.' }];
  const { findings } = findOverlaps(chapters, corpora, { minWords: SHINGLE_SIZE });
  assert.equal(findings.length, 1, 'curly and straight apostrophes normalize to the same token');
  assert.equal(findings[0].words, 8);
});

test('normalization: case-fold makes an uppercase run match a lowercase one', () => {
  const chapters = [{ file: 'chapters/x.md', text: 'AMBER LANTERN DRIFTS QUIETLY ACROSS THE EMPTY HARBOR tonight.' }];
  const corpora = [{ source: 'src/a.md', text: 'amber lantern drifts quietly across the empty harbor here, as always.' }];
  const { findings } = findOverlaps(chapters, corpora, { minWords: SHINGLE_SIZE });
  assert.equal(findings.length, 1, 'toLowerCase equates the two cases');
  assert.equal(findings[0].words, 8);
});

test('normalization: an NBSP between two words is whitespace, splitting into the same tokens as a plain space', () => {
  const chapters = [{ file: 'chapters/x.md', text: 'silent engines hum' + '\u00a0' + 'beneath the frozen bridge tonight here, quietly.' }];
  const corpora = [{ source: 'src/a.md', text: 'silent engines hum beneath the frozen bridge tonight matches.' }];
  const { findings } = findOverlaps(chapters, corpora, { minWords: SHINGLE_SIZE });
  assert.equal(findings.length, 1, 'NBSP is whitespace for tokenization purposes (ECMAScript \\s includes U+00A0)');
  assert.equal(findings[0].words, 8);
});

// =====================================================================================
// Part 2: shingle-merge arithmetic (hand-computable). A 30-word lift with no internal
// punctuation produces 30 - 8 + 1 = 23 overlapping 8-word shingles, which chain into one
// 30-word merged span: the brief's own worked example.
// =====================================================================================

const LIFT_30 = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu one two three four';

test('shingle-merge arithmetic: a 30-word lift is 23 chained 8-word shingles merging into one 30-word span', () => {
  assert.equal(LIFT_30.split(' ').length, 30, 'fixture sanity: the lift is exactly 30 words');
  const expectedShingleCount = 30 - SHINGLE_SIZE + 1;
  assert.equal(expectedShingleCount, 23, 'hand-computed shingle count for a 30-word run');

  const chapters = [{ file: 'chapters/x.md', text: 'Unattributed prose starts here: ' + LIFT_30 + ' and then moves on to other matters entirely.' }];
  const corpora = [{ source: 'src/packet.md', text: 'Packet notes: ' + LIFT_30 + ' is the phrase to remember. End of packet.' }];

  const { findings } = findOverlaps(chapters, corpora);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].words, 30, '23 chained shingles merge into one 30-word span (23 + (8 - 1) = 30)');
  assert.equal(findings[0].chapterSpan.end - findings[0].chapterSpan.start, 30);
  assert.equal(findings[0].sourceSpan.end - findings[0].sourceSpan.start, 30);
});

// =====================================================================================
// Part 3: threshold edges. 14-word lift silent, 15-word lift flags, at the default
// minWords (15). This is also the mutation-proof test for an off-by-one in the
// span-merge boundary: computing words as (run length) + SHINGLE_SIZE - 1 instead of
// + SHINGLE_SIZE turns the 15-word case's span into 14 words, which then falls silent
// too, turning this test red.
// =====================================================================================

const LIFT_14 = 'able baker cedar delta ember flint gamma hydra iota jetty kappa lunar mango nectar';
const LIFT_15 = 'quartz ridge silver timber umber velvet willow xenon yonder zephyr ashen birch cobalt driftwood elm';

test('threshold edge: a 14-word lift is silent at the default minWords (15)', () => {
  assert.equal(LIFT_14.split(' ').length, 14);
  const chapters = [{ file: 'chapters/x.md', text: 'Some prose precedes this: ' + LIFT_14 + ' and prose follows it too.' }];
  const corpora = [{ source: 'src/a.md', text: 'Reference: ' + LIFT_14 + ' documented here for the record.' }];
  const { findings } = findOverlaps(chapters, corpora);
  assert.equal(findings.length, 0, '14 words is below the default 15-word floor');
});

test('threshold edge: a 15-word lift flags at the default minWords (15)', () => {
  assert.equal(LIFT_15.split(' ').length, 15);
  const chapters = [{ file: 'chapters/x.md', text: 'Some prose precedes this: ' + LIFT_15 + ' and prose follows it too.' }];
  const corpora = [{ source: 'src/a.md', text: 'Reference: ' + LIFT_15 + ' documented here for the record.' }];
  const { findings } = findOverlaps(chapters, corpora);
  assert.equal(findings.length, 1, '15 words meets the default 15-word floor');
  assert.equal(findings[0].words, 15);
});

test('--min-words override: a 15-word lift is silent at minWords=25, a 30-word lift still flags', () => {
  const chapters = [{
    file: 'chapters/x.md',
    text: 'First: ' + LIFT_15 + ' then separately: ' + LIFT_30 + ' end of chapter.',
  }];
  const corpora = [
    { source: 'src/a.md', text: 'Reference: ' + LIFT_15 + ' documented here.' },
    { source: 'src/packet.md', text: 'Packet: ' + LIFT_30 + ' is the phrase.' },
  ];
  const { findings } = findOverlaps(chapters, corpora, { minWords: 25 });
  assert.equal(findings.length, 1, 'only the 30-word lift survives a 25-word floor');
  assert.equal(findings[0].words, 30);
  assert.equal(findings[0].source, 'src/packet.md');
});

// =====================================================================================
// Part 4: finding shape - both spans always present, excerpts capped at 40 words.
// =====================================================================================

test('finding shape: both chapterSpan and sourceSpan are always present, with capped 40-word excerpts', () => {
  const words45 = Array.from({ length: 45 }, (_, i) => 'tok' + (i + 1)).join(' ');
  const chapters = [{ file: 'chapters/x.md', text: 'Lead-in prose. ' + words45 + ' Trailing prose follows.' }];
  const corpora = [{ source: 'src/a.md', text: 'Source lead-in. ' + words45 + ' Source trailing text.' }];
  const { findings } = findOverlaps(chapters, corpora);

  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.words, 45);
  assert.ok(f.chapterSpan && typeof f.chapterSpan.start === 'number' && typeof f.chapterSpan.end === 'number');
  assert.ok(f.sourceSpan && typeof f.sourceSpan.start === 'number' && typeof f.sourceSpan.end === 'number');
  assert.equal(f.chapterSpan.excerpt.split(' ').length, 41, '40 excerpt words plus the trailing "..." token');
  assert.ok(f.chapterSpan.excerpt.endsWith(' ...'), 'a truncated excerpt is marked, not silently cut');
  assert.equal(f.chapterSpan.excerpt.split(' ')[0], 'tok1');
  assert.equal(f.chapterSpan.excerpt.split(' ')[39], 'tok40');
});

test('finding shape: an excerpt at or under the 40-word cap carries no truncation marker', () => {
  const words10 = 'orbit signal cannot verify itself without proper context beyond doubt';
  assert.equal(words10.split(' ').length, 10);
  const chapters = [{ file: 'chapters/x.md', text: 'Lead-in: ' + words10 + ' trailing text.' }];
  const corpora = [{ source: 'src/a.md', text: 'Source: ' + words10 + ' trailing.' }];
  const { findings } = findOverlaps(chapters, corpora, { minWords: SHINGLE_SIZE });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].chapterSpan.excerpt, words10.toLowerCase());
});

// =====================================================================================
// Part 5: the fixture book - flagged lift, quoted-and-anchored exclusion, clean chapter,
// and context/prior-work discovery, all read from tests/engines/fixtures/overlap/.
// =====================================================================================

function loadFixtureBook() {
  const chapterDir = join(FIXTURE_ROOT, 'chapters');
  const chapters = readdirSync(chapterDir).filter(f => f.endsWith('.md')).sort().map(f => ({
    file: 'chapters/' + f,
    text: readFileSync(join(chapterDir, f), 'utf8'),
  }));
  const corpora = discoverCorpora(FIXTURE_ROOT);
  return { chapters, corpora };
}

test('fixture book: the planted 30-word lift flags with both spans naming the chapter and the packet', () => {
  const { chapters, corpora } = loadFixtureBook();
  const { findings } = findOverlaps(chapters, corpora);

  const ch01Findings = findings.filter(f => f.chapter === 'chapters/01-packet-lift.md');
  // Two independent corpus texts contain the same 30-word lift (the packet, and the
  // evidence-log's own EV-0001 verbatim field), so the unquoted lift legitimately
  // flags against both - see hooks/lib/overlap-engine.mjs's findOverlaps doc comment
  // on why the exclusion count (not the finding count) is what stays deduplicated.
  assert.equal(ch01Findings.length, 2, 'the lift flags against both the packet and the ledger verbatim entry');

  const vsPacket = ch01Findings.find(f => f.source === 'research/packets/01-packet.md');
  assert.ok(vsPacket, 'one finding names the packet as the source');
  assert.equal(vsPacket.words, 30);
  assert.ok(vsPacket.chapterSpan.excerpt.startsWith('alpha bravo charlie'));
  assert.ok(vsPacket.chapterSpan.excerpt.endsWith('two three four'));
  assert.ok(vsPacket.sourceSpan.excerpt.startsWith('alpha bravo charlie'));

  const vsLedger = ch01Findings.find(f => f.source === 'research/evidence-log.md#EV-0001');
  assert.ok(vsLedger, 'the other finding names the evidence-log verbatim entry as the source');
  assert.equal(vsLedger.words, 30);

});

test('fixture book: the quoted-and-anchored copy of the same lift does not flag, and the exclusion count reports 1', () => {
  const { chapters, corpora } = loadFixtureBook();
  const { findings, excluded } = findOverlaps(chapters, corpora);

  const ch02Findings = findings.filter(f => f.chapter === 'chapters/02-quoted-lift.md');
  assert.equal(ch02Findings.length, 0, 'the quoted, [quote: EV-0001]-anchored copy is excluded, not flagged');
  assert.equal(excluded, 1, 'the exclusion count reports exactly 1 (one properly-quoted region), never silently');
});

test('fixture book: the clean chapter yields zero findings', () => {
  const { chapters, corpora } = loadFixtureBook();
  const { findings } = findOverlaps(chapters, corpora);
  const ch03Findings = findings.filter(f => f.chapter === 'chapters/03-clean.md');
  assert.equal(ch03Findings.length, 0);
});

test('fixture book: corpus discovery reaches context/prior-work/*.md when present', () => {
  const { chapters, corpora } = loadFixtureBook();
  assert.ok(corpora.some(c => c.source === 'context/prior-work/old-notes.md'), 'prior-work file was discovered');

  const { findings } = findOverlaps(chapters, corpora);
  const ch04Findings = findings.filter(f => f.chapter === 'chapters/04-priorwork-lift.md');
  assert.equal(ch04Findings.length, 1, 'the 15-word lift from the prior-work file flags at the default threshold');
  assert.equal(ch04Findings[0].source, 'context/prior-work/old-notes.md');
  assert.equal(ch04Findings[0].words, 15);
});

test('fixture book: total findings and exclusions across the whole book', () => {
  const { chapters, corpora } = loadFixtureBook();
  const { findings, excluded } = findOverlaps(chapters, corpora);
  assert.equal(findings.length, 3, '2 from chapter 1, 1 from chapter 4');
  assert.equal(excluded, 1, '1 from chapter 2');
});

// =====================================================================================
// Part 6: sorted enumeration - discoverCorpora enumerates in sorted filename order
// (packets, and ledger entries by EV id) regardless of directory-listing or file order.
// =====================================================================================

test('sorted enumeration: discoverCorpora returns packets and verbatim entries in sorted order regardless of on-disk order', () => {
  const base = mkdtempSync(join(os.tmpdir(), 'ns-overlap-sort-'));
  try {
    mkdirSync(join(base, 'research', 'packets'), { recursive: true });
    // Written out of alphabetical order on purpose.
    writeFileSync(join(base, 'research', 'packets', 'm-mid.md'), 'mid packet text here for testing purposes only today.');
    writeFileSync(join(base, 'research', 'packets', 'z-last.md'), 'last packet text here for testing purposes only today.');
    writeFileSync(join(base, 'research', 'packets', 'a-first.md'), 'first packet text here for testing purposes only today.');

    // EV-0002 defined before EV-0001 in document order, both carrying a verbatim field.
    writeFileSync(join(base, 'research', 'evidence-log.md'), [
      '### EV-0002 (second in the file)',
      '- claim: A claim.',
      '- source: SRC-0001',
      '- locator:',
      '- confidence: high',
      '- status: verified',
      '- added-by: research-librarian',
      '- date: 2026-09-04',
      '- verbatim: second entry verbatim text here for testing.',
      '',
      '### EV-0001 (first EV id, second in the file)',
      '- claim: A claim.',
      '- source: SRC-0001',
      '- locator:',
      '- confidence: high',
      '- status: verified',
      '- added-by: research-librarian',
      '- date: 2026-09-04',
      '- verbatim: first entry verbatim text here for testing.',
    ].join('\n'));

    const corpora = discoverCorpora(base);
    const sources = corpora.map(c => c.source);
    assert.deepEqual(sources, [
      'research/packets/a-first.md',
      'research/packets/m-mid.md',
      'research/packets/z-last.md',
      'research/evidence-log.md#EV-0001',
      'research/evidence-log.md#EV-0002',
    ]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('corpus discovery: a missing context/prior-work/ directory contributes nothing and does not error', () => {
  const base = mkdtempSync(join(os.tmpdir(), 'ns-overlap-noprior-'));
  try {
    // No research/ or context/ directories at all.
    const corpora = discoverCorpora(base);
    assert.deepEqual(corpora, []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// =====================================================================================
// Part 6b: findings order is stable code-unit order, never locale-collated order. On this
// machine's ICU, 'a-chapter.md'.localeCompare('B-chapter.md') is negative (collation
// compares base letters before case, so lowercase "a" sorts before uppercase "B"), while
// plain code-unit order places 'B-chapter.md' first (0x42 < 0x61). Two chapters that each
// independently overlap the same corpus source let the finding order stand in for the
// comparator directly, exercising the public findOverlaps output rather than an internal
// sort function.
// =====================================================================================

test('findings order: two chapters whose names collate one way under locale rules and the other way under code-unit order sort by code unit', () => {
  assert.ok(
    'a-chapter.md'.localeCompare('B-chapter.md') < 0,
    'fixture precondition: this Node build\'s ICU collates lowercase "a" before uppercase "B"'
  );

  const lift = LIFT_15;
  const chapters = [
    { file: 'a-chapter.md', text: 'Some prose precedes this: ' + lift + ' and prose follows it too.' },
    { file: 'B-chapter.md', text: 'Different framing entirely: ' + lift + ' closes out the paragraph.' },
  ];
  const corpora = [{ source: 'src/shared.md', text: 'Reference: ' + lift + ' documented here for the record.' }];

  const { findings } = findOverlaps(chapters, corpora);
  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map(f => f.chapter),
    ['B-chapter.md', 'a-chapter.md'],
    'code-unit order places the capital-letter filename first, opposite of locale-collated order'
  );
});

// =====================================================================================
// Part 7: CLI anatomy - spawns the real binary.
// =====================================================================================

function spawnOverlap(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: process.env });
}

test('CLI: --help exits 0 and prints usage', () => {
  const result = spawnOverlap(['--help']);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('ns-overlap'));
  assert.ok(result.stdout.includes('--min-words'));
});

test('CLI: exit 1 with findings on the fixture book, --json shape carries findings, excluded, no timestamp field', () => {
  const result = spawnOverlap(['--project=' + FIXTURE_ROOT, '--json']);
  assert.equal(result.status, 1, 'stderr: ' + result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.check, 'overlap');
  assert.equal(json.minWords, DEFAULT_MIN_WORDS);
  assert.equal(json.findings.length, 3);
  assert.equal(json.excluded, 1);
  assert.ok(!Object.prototype.hasOwnProperty.call(json, 'ts'), 'no wall-clock timestamp field in the JSON output');
  assert.deepEqual(json.chapters, [
    'chapters/01-packet-lift.md',
    'chapters/02-quoted-lift.md',
    'chapters/03-clean.md',
    'chapters/04-priorwork-lift.md',
  ]);
});

test('CLI: human mode reports the exclusion count as a NOTICE, never silently', () => {
  const result = spawnOverlap(['--project=' + FIXTURE_ROOT]);
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes('NOTICE'), 'human output names the exclusion count; got: ' + result.stdout);
  assert.ok(result.stdout.includes('1 span(s) excluded'));
});

test('CLI: exit 0 clean on a project with no overlap findings', () => {
  const base = mkdtempSync(join(os.tmpdir(), 'ns-overlap-clean-'));
  try {
    mkdirSync(join(base, '.studio'), { recursive: true });
    mkdirSync(join(base, 'context'), { recursive: true });
    mkdirSync(join(base, 'chapters'), { recursive: true });
    writeFileSync(join(base, '.studio', 'meta.json'), JSON.stringify({
      schema_version: '2', created: '2026-09-04T09:00:00Z', plugin_version_at_creation: '0.1.0', book_title: 'Clean',
    }));
    writeFileSync(join(base, 'chapters', '01-x.md'), 'This chapter has nothing in common with any corpus text at all.');
    const result = spawnOverlap(['--project=' + base, '--json']);
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.findings.length, 0);
    assert.equal(json.excluded, 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('CLI: --min-words=25 override changes the flagged set (15-word prior-work lift goes silent, 30-word packet lift still flags)', () => {
  const result = spawnOverlap(['--project=' + FIXTURE_ROOT, '--min-words=25', '--json']);
  assert.equal(result.status, 1, 'stderr: ' + result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.minWords, 25);
  assert.ok(!json.findings.some(f => f.chapter === 'chapters/04-priorwork-lift.md'), 'the 15-word lift is silent at minWords=25');
  assert.ok(json.findings.some(f => f.chapter === 'chapters/01-packet-lift.md'), 'the 30-word lift still flags at minWords=25');
});

test('CLI: --min-words rejects a non-positive-integer value with exit 2', () => {
  const result = spawnOverlap(['--project=' + FIXTURE_ROOT, '--min-words=zero']);
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes('--min-words'));
});

test('CLI: an unknown flag exits 2', () => {
  const result = spawnOverlap(['--project=' + FIXTURE_ROOT, '--bogus']);
  assert.equal(result.status, 2);
});

test('CLI determinism: two runs over the fixture book produce byte-identical --json output', () => {
  const first = spawnSync(process.execPath, [BIN, '--project=' + FIXTURE_ROOT, '--json'], { encoding: 'buffer', env: process.env });
  const second = spawnSync(process.execPath, [BIN, '--project=' + FIXTURE_ROOT, '--json'], { encoding: 'buffer', env: process.env });
  assert.equal(first.status, second.status);
  assert.ok(first.stdout.equals(second.stdout), 'stdout buffers are byte-identical across two runs');
});
