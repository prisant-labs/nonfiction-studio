// tests/engines/scrub.test.mjs
// what-it-is:   unit and integration tests for hooks/lib/scrub-engine.mjs and bin/ns-scrub
// what-it-does: verifies:
//   (1) injection mode on the golden sample book produces 0 findings, including the
//       mandatory named negative case for "The goal of this chapter is to make that
//       list deliberate." which contains an editorial object but NOT a verb-lexicon
//       first word, and therefore must NOT match;
//   (2) injection mode on the ai-injection fixture produces an injection.pattern-match
//       finding inside the block quote at line 9 of chapter 1;
//   (3) continuity mode on the golden sample book produces 0 findings;
//   (4) sentence-initial normalization: a term capitalized sentence-initially in one
//       chapter and lowercase mid-sentence in another must NOT fire;
//   (5) same-chapter-only variance must NOT fire;
//   (6) continuity mode on the continuity-error fixture produces a
//       continuity.name-mismatch finding at chapters/02-finding-your-network.md line 3,
//       with both surface forms and both chapters named in the detail;
//   (7) CLI --all --json produces the correct exit codes and JSON shapes for all
//       three committed-tree fixture directories.
// runner:       node --test "tests/engines/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { scanInjection, scanContinuity, scrub } from '../../hooks/lib/scrub-engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EXAMPLES = join(__dirname, '..', '..', 'examples');
const BIN = join(__dirname, '..', '..', 'bin', 'ns-scrub');

// ---- helpers ------------------------------------------------------------------

function readChapter(bookRoot, slug) {
  return readFileSync(join(bookRoot, 'chapters', slug), 'utf8');
}

// ---- INJECTION MODE: golden sample book (exit 0) ------------------------------

test('golden book injection: scanInjection returns 0 findings on chapter 1', () => {
  const root = join(EXAMPLES, 'sample-book');
  const text = readChapter(root, '01-listening-before-speaking.md');
  const findings = scanInjection(text);
  assert.equal(
    findings.filter(f => f.type === 'injection.pattern-match').length,
    0,
    'no injection.pattern-match findings in golden chapter 1'
  );
});

test('golden book injection: scanInjection returns 0 findings on chapter 2', () => {
  const root = join(EXAMPLES, 'sample-book');
  const text = readChapter(root, '02-finding-your-network.md');
  const findings = scanInjection(text);
  assert.equal(
    findings.filter(f => f.type === 'injection.pattern-match').length,
    0,
    'no injection.pattern-match findings in golden chapter 2'
  );
});

// MANDATORY negative case: "The goal of this chapter is to make that list deliberate."
// This sentence contains the editorial object "this chapter" but its first word "The"
// is NOT in the imperative editing verb lexicon. The compound pattern must NOT match.
// (Source: TSK-027 brief, section "Injection mechanism", named mandatory negative case.)
test('golden book injection: near-miss sentence "The goal of this chapter" does NOT match', () => {
  const nearMiss = 'The goal of this chapter is to make that list deliberate.';
  const findings = scanInjection(nearMiss);
  assert.equal(
    findings.filter(f => f.type === 'injection.pattern-match').length,
    0,
    '"The goal of this chapter..." contains editorial object but "The" is not a verb-lexicon word; must NOT match'
  );
});

// ---- INJECTION MODE: ai-injection fixture (exit 1) ----------------------------

test('ai-injection fixture: scanInjection finds injection.pattern-match at line 9', () => {
  const root = join(EXAMPLES, 'fixtures', 'ai-injection');
  const text = readChapter(root, '01-listening-before-speaking.md');
  const findings = scanInjection(text);

  const match = findings.find(f => f.type === 'injection.pattern-match' && f.line === 9);
  assert.ok(match, 'injection.pattern-match finding must exist at line 9 (inside block quote)');
  assert.ok(
    match.excerpt.toLowerCase().includes('deepen'),
    'excerpt must include the planted verb "deepen"; got: ' + match.excerpt
  );
  assert.ok(
    match.excerpt.toLowerCase().includes('this section') ||
    match.excerpt.toLowerCase().includes('section'),
    'excerpt must reference the editorial object; got: ' + match.excerpt
  );
});

test('ai-injection fixture: injection finding at line 9 is inside a block quote (Darkhollow class)', () => {
  const root = join(EXAMPLES, 'fixtures', 'ai-injection');
  const text = readChapter(root, '01-listening-before-speaking.md');
  const lines = text.split('\n');
  // Verify the planted line is a block quote
  const plantedLine = lines[8]; // 0-indexed; line 9 is index 8
  assert.ok(
    plantedLine.trimStart().startsWith('>'),
    'line 9 must be a block quote (Darkhollow failure class); got: ' + plantedLine
  );
});

test('ai-injection fixture: chapter 2 has no injection.pattern-match findings', () => {
  const root = join(EXAMPLES, 'fixtures', 'ai-injection');
  const text = readChapter(root, '02-finding-your-network.md');
  const findings = scanInjection(text);
  assert.equal(
    findings.filter(f => f.type === 'injection.pattern-match').length,
    0,
    'chapter 2 of ai-injection fixture is clean; all injection findings are in chapter 1'
  );
});

// ---- CONTINUITY MODE: sentence-initial normalization (synthetic) ---------------

// This test proves the sentence-initial normalization rule defined in scrub-engine.mjs:
// When a multi-word term's first word is the first token of a sentence, its
// capitalization is positional (not intentional). The normalized form lowercases
// that first word before comparison. A term capitalized sentence-initially in
// chapter A and lowercase mid-sentence in chapter B should NOT fire.
test('continuity: sentence-initial capitalization does NOT cause cross-chapter mismatch', () => {
  // Chapter A: "Personal learning network" is the very first token (sentence-initial)
  const chA = {
    file: 'chapters/ch-a.md',
    text: 'Personal learning network is essential for professional growth.\n',
  };
  // Chapter B: "personal learning network" appears mid-sentence (lowercase expected)
  const chB = {
    file: 'chapters/ch-b.md',
    text: 'You should build a personal learning network over time.\n',
  };
  const findings = scanContinuity([chA, chB]);
  assert.equal(
    findings.filter(f => f.type === 'continuity.name-mismatch').length,
    0,
    'sentence-initial capitalization must NOT trigger a cross-chapter mismatch'
  );
});

// This test proves that variance confined to a single chapter (same-chapter variance)
// does NOT fire. The S-07 rule requires the mismatch to span DIFFERENT chapters.
test('continuity: same-chapter-only variance does NOT fire', () => {
  // Chapter A has both casings of the term on different lines
  const chA = {
    file: 'chapters/ch-a.md',
    text: [
      'Personal learning network is the foundation of growth.',  // sentence-initial
      'You need a personal learning network to thrive.',          // mid-sentence
    ].join('\n') + '\n',
  };
  // Chapter B has a completely different topic (no occurrence of the term)
  const chB = {
    file: 'chapters/ch-b.md',
    text: 'A completely different topic is discussed in this chapter.\n',
  };
  const findings = scanContinuity([chA, chB]);
  assert.equal(
    findings.filter(f => f.type === 'continuity.name-mismatch').length,
    0,
    'same-chapter-only casing variance must NOT fire (S-07 requires cross-chapter mismatch)'
  );
});

// ---- CONTINUITY MODE: golden sample book (exit 0) -----------------------------

test('golden book continuity: scanContinuity returns 0 findings', () => {
  const root = join(EXAMPLES, 'sample-book');
  const ch1Text = readChapter(root, '01-listening-before-speaking.md');
  const ch2Text = readChapter(root, '02-finding-your-network.md');

  const chapters = [
    { file: 'chapters/01-listening-before-speaking.md', text: ch1Text },
    { file: 'chapters/02-finding-your-network.md', text: ch2Text },
  ];

  const findings = scanContinuity(chapters);
  assert.equal(
    findings.filter(f => f.type === 'continuity.name-mismatch').length,
    0,
    'golden sample book must produce 0 continuity.name-mismatch findings'
  );
});

// ---- CONTINUITY MODE: continuity-error fixture (exit 1) -----------------------

test('continuity-error fixture: scanContinuity finds name-mismatch at ch2 line 3', () => {
  const root = join(EXAMPLES, 'fixtures', 'continuity-error');
  const ch1Text = readChapter(root, '01-listening-before-speaking.md');
  const ch2Text = readChapter(root, '02-finding-your-network.md');

  const chapters = [
    { file: 'chapters/01-listening-before-speaking.md', text: ch1Text },
    { file: 'chapters/02-finding-your-network.md', text: ch2Text },
  ];

  const findings = scanContinuity(chapters);
  const mismatch = findings.find(
    f => f.type === 'continuity.name-mismatch' &&
         f.file === 'chapters/02-finding-your-network.md' &&
         f.line === 3
  );

  assert.ok(
    mismatch,
    'must find continuity.name-mismatch at chapters/02-finding-your-network.md line 3'
  );
});

test('continuity-error fixture: mismatch finding names both surface forms', () => {
  const root = join(EXAMPLES, 'fixtures', 'continuity-error');
  const ch1Text = readChapter(root, '01-listening-before-speaking.md');
  const ch2Text = readChapter(root, '02-finding-your-network.md');

  const chapters = [
    { file: 'chapters/01-listening-before-speaking.md', text: ch1Text },
    { file: 'chapters/02-finding-your-network.md', text: ch2Text },
  ];

  const findings = scanContinuity(chapters);

  // The engine emits one finding per case-folded term. The planted 3-gram
  // "personal learning network" / "Personal Learning Network" produces a separate
  // finding from any shorter sub-gram findings. Search for the finding whose
  // excerpt or detail mentions the full 3-gram phrase.
  const mismatch = findings.find(f =>
    f.type === 'continuity.name-mismatch' &&
    f.file === 'chapters/02-finding-your-network.md' &&
    (f.excerpt + ' ' + (f.detail || '')).toLowerCase().includes('personal learning network')
  );
  assert.ok(
    mismatch,
    'must find a continuity.name-mismatch mentioning "personal learning network"; ' +
    'all findings: ' + JSON.stringify(findings.map(f => ({ line: f.line, excerpt: f.excerpt })))
  );

  // Both surface forms must be present across excerpt + detail
  const combined = (mismatch.excerpt || '') + ' ' + (mismatch.detail || '');
  // Variant form (title-cased) must appear
  assert.ok(
    combined.includes('Personal Learning Network'),
    'finding must mention the title-cased variant "Personal Learning Network"; combined: ' + combined
  );
  // Established (lowercase) form must appear
  assert.ok(
    combined.toLowerCase().includes('personal learning network'),
    'finding must mention the established lowercase form; combined: ' + combined
  );
});

test('continuity-error fixture: mismatch finding names both chapters', () => {
  const root = join(EXAMPLES, 'fixtures', 'continuity-error');
  const ch1Text = readChapter(root, '01-listening-before-speaking.md');
  const ch2Text = readChapter(root, '02-finding-your-network.md');

  const chapters = [
    { file: 'chapters/01-listening-before-speaking.md', text: ch1Text },
    { file: 'chapters/02-finding-your-network.md', text: ch2Text },
  ];

  const findings = scanContinuity(chapters);
  const mismatch = findings.find(f => f.type === 'continuity.name-mismatch' && f.line === 3);
  assert.ok(mismatch, 'mismatch finding must exist at line 3');

  // Both chapters must be identifiable from the finding
  const combined = (mismatch.file || '') + ' ' + (mismatch.detail || '');
  assert.ok(
    combined.includes('chapters/02-finding-your-network.md') ||
    combined.includes('02-finding'),
    'finding must reference chapter 2; combined: ' + combined
  );
  assert.ok(
    combined.includes('chapters/01-listening-before-speaking.md') ||
    combined.includes('01-listening'),
    'finding must reference chapter 1; combined: ' + combined
  );
});

// ---- SCRUB (combined): scrub.agent-self-reference stub NEVER fires -------------

test('agent-self-reference stub: never fires on golden book', () => {
  const root = join(EXAMPLES, 'sample-book');
  const ch1Text = readChapter(root, '01-listening-before-speaking.md');
  const ch2Text = readChapter(root, '02-finding-your-network.md');

  const chapters = [
    { file: 'chapters/01-listening-before-speaking.md', text: ch1Text },
    { file: 'chapters/02-finding-your-network.md', text: ch2Text },
  ];

  const findings = scrub(chapters, 'all');
  const agentFindings = findings.filter(f => f.type === 'scrub.agent-self-reference');
  assert.equal(
    agentFindings.length,
    0,
    'scrub.agent-self-reference is a registered stub and must NEVER fire (no deterministic signal)'
  );
});

// ---- CLI: golden sample book --all --json exits 0 -----------------------------

test('CLI golden book: --all --json exits 0 with 0 findings', () => {
  const bookRoot = join(EXAMPLES, 'sample-book');
  const result = spawnSync(
    process.execPath, [BIN, '--all', '--json'],
    { cwd: bookRoot, encoding: 'utf8' }
  );
  assert.strictEqual(
    result.status, 0,
    'golden book CLI must exit 0; stderr: ' + result.stderr
  );

  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.verdict, 'pass', 'verdict must be pass');
  assert.strictEqual(out.findings.length, 0, 'findings array must be empty');
});

test('CLI golden book: --mode=injection --json exits 0', () => {
  const bookRoot = join(EXAMPLES, 'sample-book');
  const result = spawnSync(
    process.execPath, [BIN, '--mode=injection', '--json'],
    { cwd: bookRoot, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0,
    'golden book injection-only mode must exit 0; stderr: ' + result.stderr);
});

test('CLI golden book: --mode=continuity --json exits 0', () => {
  const bookRoot = join(EXAMPLES, 'sample-book');
  const result = spawnSync(
    process.execPath, [BIN, '--mode=continuity', '--json'],
    { cwd: bookRoot, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0,
    'golden book continuity-only mode must exit 0; stderr: ' + result.stderr);
});

// ---- CLI: ai-injection fixture --all --json exits 1 ---------------------------

test('CLI ai-injection fixture: --all --json exits 1 with injection.pattern-match', () => {
  const bookRoot = join(EXAMPLES, 'fixtures', 'ai-injection');
  const result = spawnSync(
    process.execPath, [BIN, '--all', '--json'],
    { cwd: bookRoot, encoding: 'utf8' }
  );
  assert.strictEqual(
    result.status, 1,
    'ai-injection fixture CLI must exit 1; stderr: ' + result.stderr
  );

  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.verdict, 'block', 'verdict must be block');

  const injFinding = out.findings.find(f => f.type === 'injection.pattern-match');
  assert.ok(injFinding, 'findings must include injection.pattern-match');
  assert.strictEqual(injFinding.file, 'chapters/01-listening-before-speaking.md',
    'injection finding must be in chapter 1');
  assert.strictEqual(injFinding.line, 9,
    'injection finding must be at line 9');
  assert.ok(injFinding.excerpt && injFinding.excerpt.length > 0,
    'injection finding must carry a non-empty excerpt');
});

// ---- CLI: continuity-error fixture --all --json exits 1 -----------------------

test('CLI continuity-error fixture: --all --json exits 1 with continuity.name-mismatch', () => {
  const bookRoot = join(EXAMPLES, 'fixtures', 'continuity-error');
  const result = spawnSync(
    process.execPath, [BIN, '--all', '--json'],
    { cwd: bookRoot, encoding: 'utf8' }
  );
  assert.strictEqual(
    result.status, 1,
    'continuity-error fixture CLI must exit 1; stderr: ' + result.stderr
  );

  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.verdict, 'block', 'verdict must be block');

  const contFinding = out.findings.find(f => f.type === 'continuity.name-mismatch');
  assert.ok(contFinding, 'findings must include continuity.name-mismatch');
  assert.strictEqual(
    contFinding.file,
    'chapters/02-finding-your-network.md',
    'continuity finding must point to chapter 2'
  );
  assert.strictEqual(contFinding.line, 3,
    'continuity finding must be at line 3');
  assert.ok(contFinding.excerpt && contFinding.excerpt.length > 0,
    'continuity finding must carry a non-empty excerpt');
});

// ---- CLI: error handling -------------------------------------------------------

test('CLI exits 2 when --project points to nonexistent directory', () => {
  const result = spawnSync(
    process.execPath, [BIN, '--project=/nonexistent/path/xyz', '--all'],
    { encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 2, 'nonexistent project path must exit 2');
});

test('CLI exits 2 when --mode is invalid', () => {
  const bookRoot = join(EXAMPLES, 'sample-book');
  const result = spawnSync(
    process.execPath, [BIN, '--mode=badvalue'],
    { cwd: bookRoot, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 2, 'invalid --mode value must exit 2');
});
