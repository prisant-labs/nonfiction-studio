// tests/engines/zero-marker-guard.test.mjs
// what-it-is:   tests for ADR-0020 (zero-marker guard), the first two written RED before the fix
// what-it-does: clones the sample book, adds a chapter of unmarked factual prose (two of its
//               facts are false), and pins every rule the record sets: the chapter warns and is
//               never called 100 percent; the warning is capped at warn in block mode; open
//               markers still block; an author attestation clears it and nothing else does; a
//               chapter under the word floor is quiet; ns-claims and the status board say
//               "unmarked"; the JSON grows additively and stays deterministic
// why:          computeCoverage scored a chapter with zero markers at 100 percent, so the gate
//               passed prose nobody marked or checked, even in block mode
// mutation proofs (ADR-0020, Consequences): removing the cap in gate-engine.mjs (deriving the
//               unmarked verdict from the configured mode) turns "capped at warn in block mode"
//               red; removing the attestation match in claims-engine.mjs (isAttestedClaimFree
//               returning false) turns "an author attestation clears" red
// runner:       node --test "tests/engines/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { writeSyntheticV5Baseline } from '../lib/synthetic-v5-baseline.mjs';
import { runGate } from '../../hooks/lib/gate-engine.mjs';
import {
  computeCoverage, countProseWords, isAttestedClaimFree, UNMARKED_WORD_FLOOR
} from '../../hooks/lib/claims-engine.mjs';
import { parseDecisionsLog, extractUnmarked, renderBoardMarkdown } from '../../hooks/lib/status-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, '..', '..', 'examples', 'sample-book');
const NS_CLAIMS = join(__dirname, '..', '..', 'bin', 'ns-claims');
const SLUG = '03-weak-ties';

// About 300 words of factual-sounding prose with no claim marker of any form. Two statements
// are false on purpose (the first transatlantic telegraph cable did not open in 1901, and the
// Dunbar figure is not 500), so a pass here is a pass on unchecked, partly wrong prose.
const UNMARKED_CHAPTER = [
  '# Chapter 3: Weak Ties',
  '',
  'The first transatlantic telegraph cable opened for messages in 1901, and within a year',
  'merchants on both sides of the ocean had rebuilt their habits around it. News that once',
  'took ten days to cross now crossed in minutes, and the people who learned of it first',
  'were rarely the people closest to the event. They were the people with the widest,',
  'loosest networks: clerks who knew shippers, shippers who knew editors, editors who knew',
  'almost everyone a little and almost no one well.',
  '',
  'Sociologists later gave this pattern a name. Acquaintances, they found, carry more new',
  'information to a job seeker than close friends do, because close friends already share',
  'what the seeker knows. Most people can maintain about 500 stable relationships at once,',
  'and the outer rings of that circle do the most surprising work. A former colleague you',
  'see twice a year is more likely to mention an opening you have never heard of than the',
  'friend you call every Sunday.',
  '',
  'None of this means the close circle does not matter. Close ties lend money, take the',
  'late-night call, and tell you the truth about your draft. But when the question is',
  'what is out there that I cannot see from here, the answer usually arrives through',
  'someone at the edge of your life rather than at its center.',
  '',
  'The practical lesson is modest. Keep the weak ties warm. Answer the occasional email',
  'from the person you met at a conference four years ago. Send the short note when a',
  'former manager changes jobs. Each of these costs a minute, and each keeps open a channel',
  'that may one day carry the one piece of news that changes your direction. The habit is',
  'small, the effect compounds slowly, and the people who keep it tend to look lucky to',
  'everyone who does not see the minutes they spent.',
  '',
].join('\n');

const CLAIM_FREE_ATTESTATION = [
  '',
  '### 2026-11-15 - no factual claims, chapter 03',
  '- actor: author',
  '- decision: Chapter 03 makes no factual claims that need a source.',
  '- rationale: It is a personal reflection with no figures, quotations or attributions.',
  '- links: chapters/' + SLUG + '.md',
  '',
].join('\n');

function cloneWithChapter(chapterText = UNMARKED_CHAPTER) {
  const base = join(os.tmpdir(), 'ns-zero-marker-test');
  mkdirSync(base, { recursive: true });
  const tmp = mkdtempSync(base + '/clone-');
  cpSync(GOLDEN, tmp, { recursive: true });
  writeFileSync(join(tmp, 'chapters', SLUG + '.md'), chapterText, 'utf8');
  // Measured after the new chapter exists, so stylometry stays quiet and cannot mask the subject.
  writeSyntheticV5Baseline(tmp);
  return tmp;
}

function setGateMode(tmp, mode) {
  const configPath = join(tmp, '_nonfiction-studio', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.gate = config.gate || {};
  config.gate.mode = mode;
  config.gate.checks = config.gate.checks || {};
  config.gate.checks.claim_coverage = Object.assign({}, config.gate.checks.claim_coverage, { enabled: true, mode });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function appendDecision(tmp, text) {
  appendFileSync(join(tmp, 'context', 'decisions.md'), text, 'utf8');
}

function claimEntry(tmp) {
  const { report } = runGate(tmp, { checkSubset: ['claims'] });
  assert.ok(report, 'the gate produced a report');
  const entry = report.checks.find(c => c.check === 'claim_coverage');
  assert.ok(entry, 'the report has a claim_coverage entry');
  return entry;
}

function withClone(fn, chapterText) {
  const tmp = cloneWithChapter(chapterText);
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- The defect (written RED before the fix) ---------------------------------------

for (const mode of ['warn', 'block']) {
  test('ADR-0020: a chapter of unmarked prose does not pass claim_coverage (' + mode + ' mode)', () => {
    withClone(tmp => {
      setGateMode(tmp, mode);
      const entry = claimEntry(tmp);
      assert.notStrictEqual(entry.verdict, 'pass',
        'unmarked prose must not pass; got detail: ' + entry.detail);
      assert.doesNotMatch(entry.detail, /100%/,
        'the detail must not report 100 percent coverage for unmarked prose');
    });
  });
}

// ---- The gate's rules ----------------------------------------------------------------

test('ADR-0020: the unmarked finding is capped at warn in block mode (mutation proof: the cap)', () => {
  withClone(tmp => {
    setGateMode(tmp, 'block');
    const { exitCode, report } = runGate(tmp, { checkSubset: ['claims'] });
    const entry = report.checks.find(c => c.check === 'claim_coverage');
    assert.equal(entry.verdict, 'warn', 'an unmarked chapter warns and never blocks; got ' + entry.verdict);
    assert.match(entry.detail, /1 chapter\(s\) unmarked: no claim markers in \d+ words of prose; claim_coverage\.unmarked/);
    assert.deepEqual(entry.evidence, ['chapters/' + SLUG + '.md']);
    assert.match(entry.next, /no factual claims/);
    assert.notEqual(exitCode, 1, 'the gate must not exit with a block for an unmarked chapter');
  });
});

test('ADR-0020: an open marker still blocks in block mode alongside an unmarked chapter', () => {
  withClone(tmp => {
    setGateMode(tmp, 'block');
    const ch1 = join(tmp, 'chapters', '01-listening-before-speaking.md');
    appendFileSync(ch1, '\nOne more sentence nobody has checked yet. [UNVERIFIED]\n', 'utf8');
    const entry = claimEntry(tmp);
    assert.equal(entry.verdict, 'block', 'the more severe verdict wins');
    assert.match(entry.detail, /1 open claim\(s\); claim_coverage\.unverified/);
    assert.match(entry.detail, /claim_coverage\.unmarked/);
    assert.ok(entry.evidence.includes('chapters/' + SLUG + '.md'));
  });
});

test('ADR-0020: an author attestation clears the chapter (mutation proof: the attestation match)', () => {
  withClone(tmp => {
    setGateMode(tmp, 'block');
    appendDecision(tmp, CLAIM_FREE_ATTESTATION);
    const entry = claimEntry(tmp);
    assert.equal(entry.verdict, 'pass', 'an attested chapter is quiet; got detail: ' + entry.detail);
    assert.doesNotMatch(entry.detail, /unmarked:/);
  });
});

test('ADR-0020: a promotion attestation without "no factual claims" does not clear the chapter', () => {
  withClone(tmp => {
    appendDecision(tmp, CLAIM_FREE_ATTESTATION.replace(
      'Chapter 03 makes no factual claims that need a source.',
      'Chapter 03 is promoted to final.'));
    assert.equal(claimEntry(tmp).verdict, 'warn');
  });
});

test('ADR-0020: an attestation by a roster agent does not clear the chapter', () => {
  withClone(tmp => {
    appendDecision(tmp, CLAIM_FREE_ATTESTATION.replace('- actor: author', '- actor: fact-checker'));
    assert.equal(claimEntry(tmp).verdict, 'warn');
  });
});

test('ADR-0020: a chapter under the word floor never warns', () => {
  const words = Array.from({ length: UNMARKED_WORD_FLOOR - 1 }, () => 'word').join(' ');
  withClone(tmp => {
    const entry = claimEntry(tmp);
    assert.equal(entry.verdict, 'pass', 'got detail: ' + entry.detail);
  }, '# Dedication\n\n' + words.split(' ').slice(2).join(' ') + '\n');
});

// ---- The engine ----------------------------------------------------------------------

test('ADR-0020: computeCoverage flags exactly the zero-marker chapters at or above the floor', () => {
  const atFloor = Array.from({ length: UNMARKED_WORD_FLOOR }, () => 'w').join(' ');
  const below = Array.from({ length: UNMARKED_WORD_FLOOR - 1 }, () => 'w').join(' ');
  const marked = { form: 'unverified', id: null, line: 1, resolved: false, status: null, reason: 'x' };
  const cov = computeCoverage([
    { file: 'chapters/b.md', markers: [], text: atFloor },
    { file: 'chapters/a.md', markers: [], text: atFloor },
    { file: 'chapters/c.md', markers: [], text: below },
    { file: 'chapters/d.md', markers: [marked], text: atFloor },
  ], []);
  assert.deepEqual(cov.unmarkedChapters, ['chapters/a.md', 'chapters/b.md'], 'sorted by code unit');
  assert.deepEqual(cov.chapters.map(c => c.unmarked), [true, true, false, false]);
  assert.deepEqual(cov.chapters.map(c => c.proseWords),
    [UNMARKED_WORD_FLOOR, UNMARKED_WORD_FLOOR, UNMARKED_WORD_FLOOR - 1, UNMARKED_WORD_FLOOR]);
  assert.equal(cov.coveragePct, 0, 'coveragePct keeps its arithmetic');
  assert.equal(countProseWords('  one\ttwo\n three  '), 3);
});

test('ADR-0020: isAttestedClaimFree matches the chapter slug as a whole token only', () => {
  const entries = parseDecisionsLog(CLAIM_FREE_ATTESTATION);
  assert.equal(isAttestedClaimFree(SLUG, entries), true);
  assert.equal(isAttestedClaimFree(SLUG + '-appendix', entries), false);
  assert.equal(isAttestedClaimFree('03-weak', entries), false);
  assert.equal(isAttestedClaimFree(SLUG, []), false);
});

// ---- ns-claims and the status board -----------------------------------------------

test('ADR-0020: ns-claims reports the unmarked chapter, keeps its exit code, and stays deterministic', () => {
  withClone(tmp => {
    const run = args => spawnSync(process.execPath, [NS_CLAIMS, ...args], { cwd: tmp, encoding: 'utf8' });
    const json1 = run(['--all', '--json']);
    const json2 = run(['--all', '--json']);
    assert.equal(json1.status, 0, 'unmarked chapters do not change the exit code; stderr: ' + json1.stderr);
    // The report's `ts` is the one deliberate wall-clock field; everything else is stable.
    const stable = s => s.replace(/"ts": "[^"]*"/, '"ts": "<ts>"');
    assert.equal(stable(json1.stdout), stable(json2.stdout), 'identical output on unchanged input, ts aside');
    const out = JSON.parse(json1.stdout);
    assert.equal(out.verdict, 'warn', 'never pass while a chapter is unmarked');
    assert.match(out.detail, /claim_coverage\.unmarked/);
    assert.deepEqual(out.unmarkedChapters, ['chapters/' + SLUG + '.md']);
    const row = out.chapters.find(c => c.file === 'chapters/' + SLUG + '.md');
    assert.equal(row.unmarked, true);
    assert.ok(row.proseWords >= UNMARKED_WORD_FLOOR);

    const text = run(['--all']);
    assert.match(text.stdout, /1 chapter\(s\) unmarked: chapters\/03-weak-ties\.md/);
    assert.doesNotMatch(text.stdout, /\] pass:/, 'never "pass" while a chapter is unmarked');

    // A single unmarked chapter has no markers to take a percentage of: no "100" anywhere.
    const one = run(['--chapter=' + SLUG]);
    assert.equal(one.status, 0, 'stderr: ' + one.stderr);
    assert.match(one.stdout, /no claim markers found; coverage not measured/);
    assert.doesNotMatch(one.stdout, /100/, 'a single unmarked chapter is never reported as 100 percent');
  });
});

test('ADR-0020: the status board shows "unmarked" from the chapter gate report', () => {
  const report = { checks: [{ check: 'claim_coverage', verdict: 'warn',
    detail: '1 chapter(s) unmarked: no claim markers in 300 words of prose; claim_coverage.unmarked' }] };
  assert.equal(extractUnmarked(report), true);
  assert.equal(extractUnmarked({ checks: [{ check: 'claim_coverage', detail: 'claim coverage 100%; no open markers' }] }), false);
  assert.equal(extractUnmarked(null), false);
  const board = {
    chapters: [{ slug: SLUG, number: '03', title: 'Weak Ties', status: 'drafting', wordCount: 300,
      openClaimCount: 0, drift: null, threshold: null, gate: 'warn', unmarked: true,
      reportPath: null, highlighted: false }],
    totals: { wordCount: 300, openClaimCount: 0, chaptersFinal: 0, chaptersTotal: null, chaptersRemaining: null },
    wholeBookGate: null,
  };
  assert.match(renderBoardMarkdown(board), /\| 300 \| - \| - \| unmarked \| warn \|/);
});
