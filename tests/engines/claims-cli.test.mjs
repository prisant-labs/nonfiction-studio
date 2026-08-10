// tests/engines/claims-cli.test.mjs
// what-it-is:   CLI-level tests for bin/ns-claims (Task 4: quote fidelity and research packets)
// what-it-does: spawns the real bin/ns-claims binary to verify --quotes and --packets, and to
//               prove the pre-existing default (no new flag) behavior is unchanged (required case 13)
// runner:       node --test "tests/engines/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, writeFileSync, mkdirSync, cpSync, mkdtempSync, rmSync, existsSync
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EXAMPLES = join(__dirname, '..', '..', 'examples');
const BIN = join(__dirname, '..', '..', 'bin', 'ns-claims');
const GOLDEN = join(EXAMPLES, 'sample-book');

function makeTempClone(sourceDir) {
  const base = join(os.tmpdir(), 'ns-claims-cli-test');
  mkdirSync(base, { recursive: true });
  const tmpDir = mkdtempSync(base + '/clone-');
  cpSync(sourceDir, tmpDir, { recursive: true });
  return tmpDir;
}

function spawnClaims(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: process.env });
}

// ---- required case 13: existing behavior is unchanged with no new flag --------

test('case 13: ns-claims with no new flag: same exit code and JSON shape as before', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnClaims(tmp, ['--json']);
    assert.strictEqual(result.status, 0, 'golden book claim coverage must still exit 0; stderr: ' + result.stderr);

    const json = JSON.parse(result.stdout);
    assert.strictEqual(json.check, 'claim_coverage', 'default report check name is unchanged');
    assert.ok(typeof json.totalMarkers === 'number', 'totalMarkers is present');
    assert.ok(typeof json.resolvedCount === 'number', 'resolvedCount is present');
    assert.ok(typeof json.coveragePct === 'number', 'coveragePct is present');
    assert.ok(Array.isArray(json.chapters), 'chapters array is present');
    assert.strictEqual(json.coveragePct, 100.0, 'coverage is still 100% on the golden book');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('case 13: ns-claims human-readable output with no new flag is unchanged', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnClaims(tmp, []);
    assert.strictEqual(result.status, 0, 'stderr: ' + result.stderr);
    assert.ok(result.stdout.startsWith('[claim_coverage] pass:'), 'human output prefix unchanged; got: ' + result.stdout);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- --quotes: read-only quote-fidelity check ----------------------------------

test('--quotes on golden book: exit 0, quote_fidelity report, zero findings (no anchors)', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnClaims(tmp, ['--quotes', '--json']);
    assert.strictEqual(result.status, 0, 'no quote anchors in the golden book: exit 0; stderr: ' + result.stderr);

    const json = JSON.parse(result.stdout);
    assert.strictEqual(json.check, 'quote_fidelity', 'report check name is quote_fidelity');
    assert.strictEqual(json.findings.length, 0, 'no findings on the golden book');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('--quotes: planted altered word produces a finding whose diff shows the changed word, with a line number', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const ledgerPath = join(tmp, 'research', 'evidence-log.md');
    const ledgerText = readFileSync(ledgerPath, 'utf8');
    const newEntry = [
      '### EV-0011 (planted cli quote-fidelity test entry)',
      '- claim: A claim added only to test the ns-claims --quotes flag.',
      '- source: SRC-0001',
      '- locator: p. 77',
      '- confidence: high',
      '- status: verified',
      '- added-by: research-librarian',
      '- date: 2026-07-18',
      '- verbatim: The planted excerpt must match this exact sentence precisely.',
    ].join('\n');
    writeFileSync(ledgerPath, ledgerText.replace(/\n+$/, '') + '\n\n' + newEntry + '\n', 'utf8');

    const chapterPath = join(tmp, 'chapters', '01-listening-before-speaking.md');
    const chapterText = readFileSync(chapterPath, 'utf8');
    writeFileSync(
      chapterPath,
      chapterText.replace(/\n+$/, '') +
        '\nA planted test quote: "The planted excerpt must match this exact sentence exactly." [quote: EV-0011]\n',
      'utf8'
    );

    const result = spawnClaims(tmp, ['--quotes', '--json']);
    assert.strictEqual(result.status, 1, 'a quote mismatch is a finding: exit 1; stderr: ' + result.stderr);

    const json = JSON.parse(result.stdout);
    assert.strictEqual(json.findings.length, 1, 'exactly one quote-fidelity finding');
    const finding = json.findings[0];
    assert.ok(typeof finding.line === 'number' && finding.line > 0, 'finding carries a line number');
    assert.ok(finding.detail.includes('precisely') && finding.detail.includes('exactly'),
      'diff names both the expected and actual word; got: ' + finding.detail);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('--quotes: existing default (--chapter etc.) argument handling still applies', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnClaims(tmp, ['--quotes', '--chapter=02-finding-your-network', '--json']);
    assert.strictEqual(result.status, 0, 'stderr: ' + result.stderr);
    const json = JSON.parse(result.stdout);
    assert.strictEqual(json.check, 'quote_fidelity');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- --packets: deterministic per-chapter research packet generation -----------

test('--packets: writes one packet per chapter under research/packets/, byte-identical on regeneration', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result1 = spawnClaims(tmp, ['--packets']);
    assert.strictEqual(result1.status, 0, 'packet generation must exit 0; stderr: ' + result1.stderr);

    const p1 = join(tmp, 'research', 'packets', '01-listening-before-speaking.md');
    const p2 = join(tmp, 'research', 'packets', '02-finding-your-network.md');
    assert.ok(existsSync(p1), 'packet for chapter 1 was written');
    assert.ok(existsSync(p2), 'packet for chapter 2 was written');

    const bytes1First = readFileSync(p1);
    const bytes2First = readFileSync(p2);

    const result2 = spawnClaims(tmp, ['--packets']);
    assert.strictEqual(result2.status, 0, 'second packet generation must also exit 0');

    const bytes1Second = readFileSync(p1);
    const bytes2Second = readFileSync(p2);

    assert.ok(bytes1First.equals(bytes1Second), 'chapter 1 packet is byte-identical across two runs');
    assert.ok(bytes2First.equals(bytes2Second), 'chapter 2 packet is byte-identical across two runs');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('--packets: does not write anything under .studio/ (D-06 single-writer state discipline)', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const before = readFileSync(join(tmp, '.studio', 'config.json'), 'utf8');
    const result = spawnClaims(tmp, ['--packets']);
    assert.strictEqual(result.status, 0, 'stderr: ' + result.stderr);
    const after = readFileSync(join(tmp, '.studio', 'config.json'), 'utf8');
    assert.strictEqual(before, after, '.studio/config.json is untouched by --packets');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
