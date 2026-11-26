// tests/engines/orphan-source.test.mjs
// what-it-is:   tests for ADR-0021 (orphan sources in the gate), the first written RED before the fix
// what-it-does: clones the sample book, deletes a source record that two verified-or-interpretation
//               ledger entries still cite, and pins every rule the record sets: claim_coverage warns
//               and names the missing source and the citing markers; the warning is capped at warn
//               in block mode; coverage stays 100 percent because the statuses did not change; a
//               chapter whose markers cite no missing source is quiet; the doctor and the gate
//               compute the missing set with one shared function, sorted by code unit
// why:          deleting a source left every claim that cited it passing the gate; only ns-doctor
//               reported it, and the Stop hook does not run ns-doctor
// mutation proof (ADR-0021, Consequences): deriving the orphan-source verdict from the configured
//               mode in gate-engine.mjs, instead of capping it at warn, turns "capped at warn in
//               block mode" red
// runner:       node --test "tests/engines/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { writeSyntheticV5Baseline } from '../lib/synthetic-v5-baseline.mjs';
import { runGate } from '../../hooks/lib/gate-engine.mjs';
import { runChecks, missingSourceRefs } from '../../hooks/lib/doctor-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, '..', '..', 'examples', 'sample-book');
const CH1 = '01-listening-before-speaking';
const CH2 = '02-finding-your-network';

function clone() {
  const base = join(os.tmpdir(), 'ns-orphan-source-test');
  mkdirSync(base, { recursive: true });
  const tmp = mkdtempSync(base + '/clone-');
  cpSync(GOLDEN, tmp, { recursive: true });
  writeSyntheticV5Baseline(tmp);
  return tmp;
}

// Removes one "### SRC-nnnn (...)" block, up to the next heading, from research/sources.md.
function deleteSource(tmp, srcId) {
  const path = join(tmp, 'research', 'sources.md');
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf('### ' + srcId + ' ');
  assert.ok(start >= 0, srcId + ' is in the sample registry');
  const next = text.indexOf('\n### ', start + 4);
  const out = text.slice(0, start) + (next >= 0 ? text.slice(next + 1) : '');
  writeFileSync(path, out, 'utf8');
}

function setClaimMode(tmp, mode) {
  const configPath = join(tmp, '_nonfiction-studio', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.gate = config.gate || {};
  config.gate.mode = mode;
  config.gate.checks = config.gate.checks || {};
  config.gate.checks.claim_coverage = Object.assign({}, config.gate.checks.claim_coverage, { enabled: true, mode });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function claimEntry(tmp, chapterSlug) {
  const { report } = runGate(tmp, { checkSubset: ['claims'], chapterSlug });
  assert.ok(report, 'the gate produced a report');
  const entry = report.checks.find(c => c.check === 'claim_coverage');
  assert.ok(entry, 'the report has a claim_coverage entry');
  return entry;
}

function withClone(fn) {
  const tmp = clone();
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- The defect (written RED before the fix) ---------------------------------------

test('ADR-0021: a deleted source cited by a chapter makes claim_coverage warn, naming the source and the markers', () => {
  withClone(tmp => {
    deleteSource(tmp, 'SRC-0003');
    const entry = claimEntry(tmp);
    assert.strictEqual(entry.verdict, 'warn', 'detail: ' + entry.detail);
    assert.match(entry.detail, /claim_coverage\.orphan-source/);
    assert.match(entry.detail, /SRC-0003/);
    assert.match(entry.detail, /EV-0001/);
    assert.match(entry.detail, /EV-0005/);
    assert.ok(entry.evidence.includes('chapters/' + CH1 + '.md#L11'), 'evidence: ' + JSON.stringify(entry.evidence));
    assert.ok(entry.evidence.includes('chapters/' + CH1 + '.md#L19'), 'evidence: ' + JSON.stringify(entry.evidence));
    assert.ok(entry.evidence.includes('research/sources.md'), 'evidence: ' + JSON.stringify(entry.evidence));
    assert.ok(entry.next && /sources\.md/.test(entry.next), 'next names the registry: ' + entry.next);
  });
});

// ---- The gate's rules ----------------------------------------------------------------

test('ADR-0021: the orphan-source finding is capped at warn in block mode (mutation proof: the cap)', () => {
  withClone(tmp => {
    deleteSource(tmp, 'SRC-0003');
    setClaimMode(tmp, 'block');
    const { exitCode, report } = runGate(tmp, { checkSubset: ['claims'] });
    const entry = report.checks.find(c => c.check === 'claim_coverage');
    assert.strictEqual(entry.verdict, 'warn', 'detail: ' + entry.detail);
    assert.strictEqual(exitCode, 0, 'a warn-only report exits 0');
  });
});

test('ADR-0021: no claim is counted open, because the ledger statuses did not change', () => {
  withClone(tmp => {
    deleteSource(tmp, 'SRC-0003');
    const entry = claimEntry(tmp);
    assert.doesNotMatch(entry.detail, /open claim/, 'detail: ' + entry.detail);
    assert.doesNotMatch(entry.detail, /claim_coverage\.unresolved/, 'detail: ' + entry.detail);
  });
});

test('ADR-0021: a chapter whose markers cite no missing source is quiet', () => {
  withClone(tmp => {
    deleteSource(tmp, 'SRC-0003');
    const entry = claimEntry(tmp, CH2);
    assert.strictEqual(entry.verdict, 'pass', 'detail: ' + entry.detail);
    assert.doesNotMatch(entry.detail, /orphan-source/);
  });
});

test('ADR-0021: the unedited sample book carries no orphan-source finding', () => {
  withClone(tmp => {
    const entry = claimEntry(tmp);
    assert.strictEqual(entry.verdict, 'pass', 'detail: ' + entry.detail);
    assert.doesNotMatch(entry.detail, /orphan-source/);
  });
});

test('ADR-0021: two missing sources are listed in code-unit order, the same in the doctor and the gate', () => {
  withClone(tmp => {
    deleteSource(tmp, 'SRC-0003');
    deleteSource(tmp, 'SRC-0001');
    const entry = claimEntry(tmp);
    const first = entry.detail.indexOf('SRC-0001');
    const second = entry.detail.indexOf('SRC-0003');
    assert.ok(first >= 0 && second > first, 'SRC-0001 is listed before SRC-0003: ' + entry.detail);

    const doctorIds = runChecks(tmp).findings
      .filter(f => f.type === 'src-ref.orphan-referenced')
      .map(f => f.message.split(' ')[2]);
    assert.deepStrictEqual(doctorIds, ['SRC-0001', 'SRC-0003']);
  });
});

test('ADR-0021: missingSourceRefs groups citing entries under each missing source, sorted by code unit', () => {
  const ev = [
    { id: 'EV-0010', source: 'SRC-0009' },
    { id: 'EV-0002', source: 'SRC-0009' },
    { id: 'EV-0003', source: 'SRC-0001' },
    { id: 'EV-0004', source: 'SRC-0002' },
    { id: 'EV-0005', source: 'none' },
  ];
  const src = [{ id: 'SRC-0002' }];
  assert.deepStrictEqual(missingSourceRefs(ev, src), [
    { srcId: 'SRC-0001', evIds: ['EV-0003'] },
    { srcId: 'SRC-0009', evIds: ['EV-0002', 'EV-0010'] },
  ]);
});
