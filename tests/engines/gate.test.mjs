// tests/engines/gate.test.mjs
// what-it-is:   integration tests for hooks/lib/gate-engine.mjs and bin/ns-gate
// what-it-does: verifies the 14-test enumeration from the TSK-029 (ns-gate orchestrator) brief:
//   T01: golden book warn defaults: exit 0; report written; schema-exact key sets; session_write_flag skip
//   T02: golden book block-mode clone: exit 0 (no findings on clean content)
//   T03: unsourced-claim warn AND block clones: exit 0; claim_coverage pass (OQ-13: unmarked invisible)
//   T04: continuity-error block clone: exit 1; continuity block; name-mismatch; chapter 2 evidence
//   T05: voice-drift block clone: exit 1; stylometry block; drift-threshold detail
//   T06: ai-injection block clone: exit 1; prompt_scrub block; injection.pattern-match; file+line evidence
//   T07: three broken fixtures warn mode: exit 0 with top-level verdict warn
//   T08: config-coercion: D-03 notice on stderr; exit 0; thesis_alignment absent from checks
//   T09: --check=claims subset: report has claim_coverage and session_write_flag only
//   T10: session-write flag present: session_write_flag verdict pass
//   T11: bad --project: exit 2
//   T12: engine error (missing stylometry baseline): exit 2; stylometry verdict skip
//   T13: prune: 11 stale + 1 new = 12 total; prune to 10; newest survives
//   T14: report filename matches <slug>.<YYYYMMDDTHHMMSSZ>.json pattern
// runner:       node --test "tests/engines/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, writeFileSync, mkdirSync,
  readdirSync, existsSync, cpSync, mkdtempSync, rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EXAMPLES = join(__dirname, '..', '..', 'examples');
const BIN      = join(__dirname, '..', '..', 'bin', 'ns-gate');
const GOLDEN   = join(EXAMPLES, 'sample-book');

// ---- helpers -------------------------------------------------------------------

/** Creates a temporary clone of a source book directory; caller must clean up. */
function makeTempClone(sourceDir) {
  const base = join(os.tmpdir(), 'ns-gate-test');
  mkdirSync(base, { recursive: true });
  const tmpDir = mkdtempSync(base + '/clone-');
  cpSync(sourceDir, tmpDir, { recursive: true });
  return tmpDir;
}

/**
 * Writes a block-mode gate config to the clone's .studio/config.json.
 * Sets gate.mode=block and all four deterministic checks to mode=block,
 * preserving the source config's thresholds and baseline per TSK-029 (ns-gate orchestrator).
 */
function writeBlockConfig(tmpDir) {
  const configPath = join(tmpDir, '.studio', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.gate = config.gate || {};
  config.gate.mode = 'block';
  config.gate.checks = config.gate.checks || {};
  for (const check of ['claim_coverage', 'prompt_scrub', 'stylometry', 'continuity']) {
    config.gate.checks[check] = Object.assign(
      {}, config.gate.checks[check] || {}, { enabled: true, mode: 'block' }
    );
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/** Spawns ns-gate with the given extra args in the given cwd. */
function spawnGate(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
  });
}

/**
 * Reads the most recently written gate report for a slug from .studio/gate/.
 * Filenames are sorted lexicographically; YYYYMMDDTHHMMSSZ is chronological.
 */
function readLatestReport(tmpDir, slug) {
  slug = slug || 'all';
  const gateDir = join(tmpDir, '.studio', 'gate');
  const prefix = slug + '.';
  const files = readdirSync(gateDir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json') && !f.startsWith('.'))
    .sort();
  if (files.length === 0) throw new Error('No gate report found for slug: ' + slug);
  return JSON.parse(readFileSync(join(gateDir, files[files.length - 1]), 'utf8'));
}

// ---- T01: golden book warn defaults -------------------------------------------

test('T01: golden book warn mode: exit 0; report written; exact schema keys; session_write_flag skip gate.no-write', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 0,
      'golden book warn mode must exit 0; stderr: ' + result.stderr);

    // Report file must be written
    const report = readLatestReport(tmp, 'all');

    // Schema-exact top-level keys per S-08 section 11: version, chapter, ts, verdict, checks
    const topKeys = Object.keys(report).sort();
    assert.deepStrictEqual(
      topKeys, ['chapter', 'checks', 'ts', 'verdict', 'version'],
      'top-level keys must be exactly: version, chapter, ts, verdict, checks; got: ' + JSON.stringify(topKeys)
    );

    // Schema-exact per-check keys: check, verdict, detail, evidence, next
    for (const entry of report.checks) {
      const ck = Object.keys(entry).sort();
      assert.deepStrictEqual(
        ck, ['check', 'detail', 'evidence', 'next', 'verdict'],
        'per-check keys must be exactly: check, verdict, detail, evidence, next on "' + entry.check + '"'
      );
    }

    // All five deterministic checks plus session_write_flag are present
    // [TSK-029b (state-coherence gate check) 2026-07-18: state_coherence added to the set]
    const names = report.checks.map(c => c.check);
    for (const n of ['claim_coverage', 'stylometry', 'prompt_scrub', 'continuity', 'state_coherence', 'session_write_flag']) {
      assert.ok(names.includes(n), '"' + n + '" must appear in checks');
    }

    // thesis_alignment is never evaluated
    assert.ok(!names.includes('thesis_alignment'), 'thesis_alignment must be absent from checks');

    // Deterministic checks pass on the golden book
    const claimsEntry = report.checks.find(c => c.check === 'claim_coverage');
    assert.strictEqual(claimsEntry.verdict, 'pass', 'claim_coverage passes on golden book');

    // session_write_flag: skip with gate.no-write detail (flag file absent)
    const swfEntry = report.checks.find(c => c.check === 'session_write_flag');
    assert.strictEqual(swfEntry.verdict, 'skip', 'session_write_flag verdict is skip');
    assert.ok(
      swfEntry.detail.includes('gate.no-write'),
      'session_write_flag detail contains gate.no-write; got: ' + swfEntry.detail
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- T02: golden book block-mode clone ----------------------------------------

test('T02: golden book block-mode clone: exit 0 (clean content has no findings)', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    writeBlockConfig(tmp);
    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 0,
      'golden book block mode must exit 0 (no findings to block on); stderr: ' + result.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- T03: unsourced-claim warn AND block clones --------------------------------

// OQ-13 (gate coherence check): the deterministic set (claims, stylometry, scrub, continuity-quick)
// cannot see an unmarked factual sentence; claim_coverage counts only PRESENT markers, so an
// unmarked sentence is invisible. Both modes exit 0 for this fixture.
test('T03-warn: unsourced-claim warn mode: exit 0; claim_coverage pass (OQ-13: unmarked sentence invisible)', () => {
  const tmp = makeTempClone(join(EXAMPLES, 'fixtures', 'unsourced-claim'));
  try {
    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 0,
      'unsourced-claim warn mode must exit 0; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const claimsEntry = report.checks.find(c => c.check === 'claim_coverage');
    assert.strictEqual(claimsEntry.verdict, 'pass',
      'claim_coverage passes: unmarked sentence is invisible to the deterministic engine');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T03-block: unsourced-claim block-mode clone: exit 0; claim_coverage pass (OQ-13)', () => {
  const tmp = makeTempClone(join(EXAMPLES, 'fixtures', 'unsourced-claim'));
  try {
    writeBlockConfig(tmp);
    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 0,
      'unsourced-claim block mode must also exit 0; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const claimsEntry = report.checks.find(c => c.check === 'claim_coverage');
    assert.strictEqual(claimsEntry.verdict, 'pass',
      'claim_coverage passes in block mode: unmarked sentence stays invisible');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- T04: continuity-error block clone ----------------------------------------

test('T04: continuity-error block clone: exit 1; continuity block; name-mismatch detail; chapter 2 evidence', () => {
  const tmp = makeTempClone(join(EXAMPLES, 'fixtures', 'continuity-error'));
  try {
    writeBlockConfig(tmp);
    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 1,
      'continuity-error block mode must exit 1; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const contEntry = report.checks.find(c => c.check === 'continuity');
    assert.ok(contEntry, 'continuity check must be present in report');
    assert.strictEqual(contEntry.verdict, 'block', 'continuity verdict must be block');

    // detail must contain the signal token
    assert.ok(
      contEntry.detail.includes('continuity.name-mismatch'),
      'detail must include signal token "continuity.name-mismatch"; got: ' + contEntry.detail
    );
    // detail must contain both surface forms (engine finding names both)
    assert.ok(
      contEntry.detail.toLowerCase().includes('personal learning network'),
      'detail must mention the mismatched term; got: ' + contEntry.detail
    );

    // evidence must point into chapter 2 with a line anchor
    assert.ok(contEntry.evidence.length > 0, 'evidence must be non-empty');
    const ch2Ptr = contEntry.evidence.find(e => e.includes('02-finding-your-network'));
    assert.ok(ch2Ptr, 'evidence must include a pointer into chapter 2; got: ' + JSON.stringify(contEntry.evidence));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- T05: voice-drift block clone ---------------------------------------------

test('T05: voice-drift block clone: exit 1; stylometry block; drift-threshold in detail with score and threshold', () => {
  const tmp = makeTempClone(join(EXAMPLES, 'fixtures', 'voice-drift'));
  try {
    writeBlockConfig(tmp);
    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 1,
      'voice-drift block mode must exit 1; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const styloEntry = report.checks.find(c => c.check === 'stylometry');
    assert.ok(styloEntry, 'stylometry check must be present in report');
    assert.strictEqual(styloEntry.verdict, 'block', 'stylometry verdict must be block');

    // detail must contain the gate-coined token
    assert.ok(
      styloEntry.detail.includes('stylometry.drift-threshold'),
      'detail must include gate-coined token "stylometry.drift-threshold"; got: ' + styloEntry.detail
    );
    // detail must contain a numeric score and threshold
    assert.ok(
      /\d+\.?\d*\s+exceeds\s+threshold\s+\d/.test(styloEntry.detail),
      'detail must show "score exceeds threshold N"; got: ' + styloEntry.detail
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- T06: ai-injection block clone --------------------------------------------

test('T06: ai-injection block clone: exit 1; prompt_scrub block; injection.pattern-match; file+line evidence', () => {
  const tmp = makeTempClone(join(EXAMPLES, 'fixtures', 'ai-injection'));
  try {
    writeBlockConfig(tmp);
    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 1,
      'ai-injection block mode must exit 1; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const scrubEntry = report.checks.find(c => c.check === 'prompt_scrub');
    assert.ok(scrubEntry, 'prompt_scrub check must be present in report');
    assert.strictEqual(scrubEntry.verdict, 'block', 'prompt_scrub verdict must be block');

    // detail must contain the signal token (engine-emitted type string)
    assert.ok(
      scrubEntry.detail.includes('injection.pattern-match'),
      'detail must include "injection.pattern-match"; got: ' + scrubEntry.detail
    );

    // evidence must name the planted file (chapter 1) with a line anchor
    assert.ok(scrubEntry.evidence.length > 0, 'evidence must be non-empty');
    const planted = scrubEntry.evidence.find(e =>
      e.includes('01-listening-before-speaking') && e.includes('#L')
    );
    assert.ok(
      planted,
      'evidence must name the planted chapter file with a line anchor; got: ' + JSON.stringify(scrubEntry.evidence)
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- T07: three visible broken fixtures in warn mode --------------------------

const BROKEN_WARN_FIXTURES = [
  ['continuity-error', join(EXAMPLES, 'fixtures', 'continuity-error')],
  ['voice-drift',      join(EXAMPLES, 'fixtures', 'voice-drift')],
  ['ai-injection',     join(EXAMPLES, 'fixtures', 'ai-injection')],
];

for (const [label, fixtureDir] of BROKEN_WARN_FIXTURES) {
  test('T07: ' + label + ' warn mode: exit 0 with top-level verdict warn', () => {
    const tmp = makeTempClone(fixtureDir);
    try {
      const result = spawnGate(tmp, ['--json']);
      assert.strictEqual(result.status, 0,
        label + ' warn mode must exit 0; stderr: ' + result.stderr);

      const report = readLatestReport(tmp, 'all');
      assert.strictEqual(report.verdict, 'warn',
        label + ' top-level verdict must be "warn"; got: ' + report.verdict);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}

// ---- T08: config-coercion fixture ---------------------------------------------

test('T08: config-coercion: D-03 coercion notice on stderr; exit 0; thesis_alignment absent from checks', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    // Apply the config from examples/fixtures/config-coercion/ (thesis_alignment.mode=block)
    // over the sample-book config (which has a valid stylometry baseline).
    // This proves D-03 Invariant 1 without breaking the stylometry check.
    const coercionConfigPath = join(EXAMPLES, 'fixtures', 'config-coercion', 'config.json');
    const coercionConfig = JSON.parse(readFileSync(coercionConfigPath, 'utf8'));
    const baseConfigPath = join(tmp, '.studio', 'config.json');
    const baseConfig = JSON.parse(readFileSync(baseConfigPath, 'utf8'));

    // Overlay only the gate block (preserves sample-book's stylometry baseline)
    baseConfig.gate = coercionConfig.gate;
    writeFileSync(baseConfigPath, JSON.stringify(baseConfig, null, 2), 'utf8');

    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 0,
      'config-coercion must exit 0 (coercion is a notice, not a failure); stderr: ' + result.stderr);

    // Coercion notice must appear on stderr
    assert.ok(
      result.stderr.includes('coercion'),
      'stderr must contain the coercion notice; got: ' + result.stderr
    );

    // thesis_alignment must not appear in the checks array (not evaluated by ns-gate)
    const report = readLatestReport(tmp, 'all');
    const thesisEntry = report.checks.find(c => c.check === 'thesis_alignment');
    assert.strictEqual(thesisEntry, undefined,
      'thesis_alignment must be absent from the checks array per D-03 (layered Stop gate)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- T09: --check=claims subset -----------------------------------------------

test('T09: --check=claims subset: report contains claim_coverage and session_write_flag only', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnGate(tmp, ['--check=claims', '--json']);
    assert.strictEqual(result.status, 0,
      '--check=claims must exit 0 on golden book; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const names = report.checks.map(c => c.check);
    assert.ok(names.includes('claim_coverage'), 'claim_coverage must be present');
    assert.ok(names.includes('session_write_flag'), 'session_write_flag must always be present');
    assert.strictEqual(
      names.length, 2,
      'exactly 2 checks for --check=claims: claim_coverage and session_write_flag; got: ' + JSON.stringify(names)
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- T10: session-write flag present ------------------------------------------

test('T10: session-write flag present in temp clone: session_write_flag verdict pass', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    // Create the session-write flag that stop-gate.mjs would normally create
    const gateDir = join(tmp, '.studio', 'gate');
    mkdirSync(gateDir, { recursive: true });
    writeFileSync(join(gateDir, '.session-write-flag'), '', 'utf8');

    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 0,
      'session-write flag present: exit 0; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const swfEntry = report.checks.find(c => c.check === 'session_write_flag');
    assert.ok(swfEntry, 'session_write_flag must be in report');
    assert.strictEqual(swfEntry.verdict, 'pass',
      'session_write_flag verdict must be pass when flag file is present');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- T11: bad --project or missing config ------------------------------------

test('T11: bad --project (nonexistent path): exit 2', () => {
  const result = spawnGate(process.cwd(), ['--project=/nonexistent/path/xyz123', '--json']);
  assert.strictEqual(result.status, 2, 'bad --project must exit 2');
});

// ---- T12: engine error path (missing stylometry baseline) ---------------------

test('T12: missing stylometry baseline: exit 2; stylometry check verdict skip with error in detail', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    // Remove the stylometry baseline from config
    const configPath = join(tmp, '.studio', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (config.stylometry) config.stylometry.baseline = null;
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 2,
      'missing baseline must cause exit 2; stderr: ' + result.stderr);

    // The report is still written (gate-engine emits report even on partial error)
    const report = readLatestReport(tmp, 'all');
    const styloEntry = report.checks.find(c => c.check === 'stylometry');
    assert.ok(styloEntry, 'stylometry entry must be present even when engine errors');
    assert.strictEqual(styloEntry.verdict, 'skip',
      'stylometry verdict must be skip on engine error');
    assert.ok(
      styloEntry.detail.includes('engine error') || styloEntry.detail.includes('baseline'),
      'detail must contain the error message; got: ' + styloEntry.detail
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- T13: prune policy --------------------------------------------------------

test('T13: prune: 11 stale reports + 1 new = 12 total; pruned to 10; newest survives', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const gateDir = join(tmp, '.studio', 'gate');
    mkdirSync(gateDir, { recursive: true });

    // Seed 11 stale report files for slug 'all' with 2025 timestamps
    for (let i = 0; i < 11; i++) {
      const day = String(i + 1).padStart(2, '0');
      const filename = 'all.202501' + day + 'T000000Z.json';
      writeFileSync(
        join(gateDir, filename),
        JSON.stringify({
          version: 2,
          chapter: 'all',
          ts: '2025-01-' + day + 'T00:00:00Z',
          verdict: 'pass',
          checks: [],
        }),
        'utf8'
      );
    }

    // Run the gate; it writes a new report (2026 timestamp) then prunes
    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 0,
      'prune test gate run must exit 0; stderr: ' + result.stderr);

    // After prune: 10 reports remain for slug 'all'
    const remaining = readdirSync(gateDir)
      .filter(f => f.startsWith('all.') && f.endsWith('.json'));
    assert.strictEqual(remaining.length, 10,
      'exactly 10 reports must remain after prune; got ' + remaining.length + ': ' + JSON.stringify(remaining));

    // The newest report (2026, just written) must survive
    const sorted = remaining.sort();
    const newestFile = sorted[sorted.length - 1];
    const newest = JSON.parse(readFileSync(join(gateDir, newestFile), 'utf8'));
    assert.ok(
      newest.ts.includes('2026'),
      'newest surviving report must be the one just written (2026 timestamp); got ts: ' + newest.ts
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- T14: report filename pattern ---------------------------------------------

test('T14: report filename matches <slug>.<YYYYMMDDTHHMMSSZ>.json pattern', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 0,
      'filename pattern test must exit 0; stderr: ' + result.stderr);

    const gateDir = join(tmp, '.studio', 'gate');
    // Filter specifically for slug 'all' reports written by this run
    const PATTERN = /^all\.\d{8}T\d{6}Z\.json$/;
    const files = readdirSync(gateDir).filter(f => PATTERN.test(f));
    assert.ok(files.length > 0, 'at least one all.* report file must be written');

    for (const filename of files) {
      assert.ok(
        PATTERN.test(filename),
        'filename must match pattern <slug>.<YYYYMMDDTHHMMSSZ>.json; got: ' + filename
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ============================================================================
// TSK-029b (state-coherence gate check) tests
// [Added 2026-07-18 per OQ-13 (gate coherence check) decision]
// T15: golden --check=coherence; T16: unsourced-claim coherence warn; T17: coherence block exit 1
// ============================================================================

/**
 * Writes a gate config that opts state_coherence into block mode.
 * Sets gate.mode=block and state_coherence.mode=block so a word-count mismatch
 * blocks the gate. Used by T17.
 */
function writeCoherenceBlockConfig(tmpDir) {
  const configPath = join(tmpDir, '.studio', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.gate = config.gate || {};
  config.gate.mode = 'block';
  config.gate.checks = config.gate.checks || {};
  config.gate.checks.state_coherence = { enabled: true, mode: 'block' };
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// ---- T15: --check=coherence on golden book ------------------------------------

test('T15: golden book --check=coherence: exit 0; report has state_coherence pass and session_write_flag only', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnGate(tmp, ['--check=coherence', '--json']);
    assert.strictEqual(result.status, 0,
      '--check=coherence on golden book must exit 0; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const names = report.checks.map(c => c.check);

    // Exactly state_coherence and session_write_flag
    assert.ok(names.includes('state_coherence'), 'state_coherence must be present');
    assert.ok(names.includes('session_write_flag'), 'session_write_flag must always be present');
    assert.strictEqual(
      names.length, 2,
      'exactly 2 checks for --check=coherence: state_coherence and session_write_flag; got: ' +
        JSON.stringify(names)
    );

    // state_coherence verdict pass on the golden book (word counts match)
    const cohEntry = report.checks.find(c => c.check === 'state_coherence');
    assert.strictEqual(cohEntry.verdict, 'pass',
      'state_coherence must pass on the golden book; got: ' + cohEntry.verdict);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- T16: unsourced-claim warn mode: state_coherence fires as warn -----------

test('T16: unsourced-claim warn mode: exit 0; state_coherence verdict warn; detail has type, chapter 2, both counts', () => {
  const tmp = makeTempClone(join(EXAMPLES, 'fixtures', 'unsourced-claim'));
  try {
    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 0,
      'unsourced-claim warn mode must exit 0; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const cohEntry = report.checks.find(c => c.check === 'state_coherence');
    assert.ok(cohEntry, 'state_coherence must appear in checks');
    assert.strictEqual(cohEntry.verdict, 'warn',
      'state_coherence verdict must be warn in default warn mode; got: ' + cohEntry.verdict);

    // detail must carry the finding type string verbatim
    assert.ok(
      cohEntry.detail.includes('coherence.word-count-mismatch'),
      'detail must include "coherence.word-count-mismatch"; got: ' + cohEntry.detail
    );
    // detail must name chapter 2
    assert.ok(
      cohEntry.detail.includes('02-finding-your-network'),
      'detail must reference chapter 02-finding-your-network; got: ' + cohEntry.detail
    );
    // detail must include the recorded count and the actual count (both word counts)
    assert.ok(
      /records \d+ words/.test(cohEntry.detail),
      'detail must include "records N words" (recorded count); got: ' + cohEntry.detail
    );
    assert.ok(
      /contains \d+ words/.test(cohEntry.detail),
      'detail must include "contains N words" (actual count); got: ' + cohEntry.detail
    );

    // evidence must include the chapter file and progress.json (the two sides of the incoherence)
    assert.ok(cohEntry.evidence.length >= 2,
      'evidence must have at least 2 pointers (chapter + progress.json); got: ' +
        JSON.stringify(cohEntry.evidence));
    assert.ok(
      cohEntry.evidence.some(e => e.includes('02-finding-your-network')),
      'evidence must include a pointer to chapter 02; got: ' + JSON.stringify(cohEntry.evidence)
    );
    assert.ok(
      cohEntry.evidence.includes('.studio/progress.json'),
      'evidence must include .studio/progress.json; got: ' + JSON.stringify(cohEntry.evidence)
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- T17: unsourced-claim block-mode (state_coherence opted to block): exit 1 --

test('T17: unsourced-claim block-mode (state_coherence block): exit 1; top-level verdict block', () => {
  const tmp = makeTempClone(join(EXAMPLES, 'fixtures', 'unsourced-claim'));
  try {
    writeCoherenceBlockConfig(tmp);
    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 1,
      'unsourced-claim with state_coherence in block mode must exit 1; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    assert.strictEqual(report.verdict, 'block',
      'top-level verdict must be "block"; got: ' + report.verdict);

    const cohEntry = report.checks.find(c => c.check === 'state_coherence');
    assert.ok(cohEntry, 'state_coherence must appear in checks');
    assert.strictEqual(cohEntry.verdict, 'block',
      'state_coherence verdict must be block when opted in; got: ' + cohEntry.verdict);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ============================================================================
// F-HK-08 (empty check list silently passes) fix
// T18: --check= (empty value) must be an argument error, not a zero-check pass
// ============================================================================

// ---- T18: --check= empty list is an argument error -----------------------

test('T18: --check= (empty list) exits 2 and names the valid check flags', () => {
  // Run against a valid book root (not process.cwd()) so the assertion actually
  // exercises the --check validation path rather than an unrelated book-root
  // discovery failure. Before the F-HK-08 fix this silently exits 0 having run
  // zero checks (only session_write_flag survives an empty requested-flags set).
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnGate(tmp, ['--check=', '--json']);
    assert.strictEqual(result.status, 2,
      '--check= with no items must exit 2 (argument error), not silently run zero checks; ' +
      'stdout: ' + result.stdout + ' stderr: ' + result.stderr);
    for (const flag of ['claims', 'stylometry', 'scrub', 'continuity-quick', 'coherence']) {
      assert.ok(
        result.stderr.includes(flag),
        'stderr must name valid check flag "' + flag + '"; got: ' + result.stderr
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ============================================================================
// OPP-D03 (quote fidelity and source packets) tests
// T19: golden --check=quotes with no anchors (pass); T20: planted mismatch warn
// mode; T21: planted mismatch block-mode coercion (structural guarantee, required
// case 9); T22: quote_fidelity disabled (required case 10)
// ============================================================================

/**
 * Plants a quote-fidelity mismatch into a CLONED book only (never the committed
 * GOLDEN fixture): appends a new EV entry carrying a verbatim excerpt, then
 * appends a paragraph to chapter 1 quoting a one-word-altered version of that
 * excerpt, anchored with [quote: EV-0011] (docs/formats/claim-markers.md form 4).
 */
function plantQuoteMismatch(tmpDir) {
  const ledgerPath = join(tmpDir, 'research', 'evidence-log.md');
  const ledgerText = readFileSync(ledgerPath, 'utf8');
  const newEntry = [
    '### EV-0011 (planted quote-fidelity test entry)',
    '- claim: A claim added only to test quote-fidelity gate wiring.',
    '- source: SRC-0001',
    '- locator: p. 99',
    '- confidence: high',
    '- status: verified',
    '- added-by: research-librarian',
    '- date: 2026-07-18',
    '- verbatim: The planted excerpt must match this exact sentence precisely.',
  ].join('\n');
  writeFileSync(ledgerPath, ledgerText.replace(/\n+$/, '') + '\n\n' + newEntry + '\n', 'utf8');

  const chapterPath = join(tmpDir, 'chapters', '01-listening-before-speaking.md');
  const chapterText = readFileSync(chapterPath, 'utf8');
  const plantedParagraph =
    '\nA planted test quote: "The planted excerpt must match this exact sentence exactly." [quote: EV-0011]\n';
  writeFileSync(chapterPath, chapterText.replace(/\n+$/, '') + '\n' + plantedParagraph, 'utf8');
}

test('T19: golden book --check=quotes: exit 0; report has quote_fidelity pass (no anchors) and session_write_flag only', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnGate(tmp, ['--check=quotes', '--json']);
    assert.strictEqual(result.status, 0,
      '--check=quotes on golden book must exit 0; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const names = report.checks.map(c => c.check);
    assert.ok(names.includes('quote_fidelity'), 'quote_fidelity must be present');
    assert.ok(names.includes('session_write_flag'), 'session_write_flag must always be present');
    assert.strictEqual(
      names.length, 2,
      'exactly 2 checks for --check=quotes: quote_fidelity and session_write_flag; got: ' + JSON.stringify(names)
    );

    const qfEntry = report.checks.find(c => c.check === 'quote_fidelity');
    assert.strictEqual(qfEntry.verdict, 'pass',
      'quote_fidelity must pass on the golden book (no quote anchors); got: ' + qfEntry.verdict);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T20: planted quote mismatch, warn mode: quote_fidelity verdict warn; top-level not block (required case 8)', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    plantQuoteMismatch(tmp);
    const result = spawnGate(tmp, ['--check=quotes', '--json']);
    assert.strictEqual(result.status, 0,
      'planted mismatch in default warn mode must exit 0; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const qfEntry = report.checks.find(c => c.check === 'quote_fidelity');
    assert.ok(qfEntry, 'quote_fidelity must appear in checks');
    assert.strictEqual(qfEntry.verdict, 'warn',
      'quote_fidelity verdict must be warn when a mismatch is found in warn mode; got: ' + qfEntry.verdict);
    assert.notStrictEqual(report.verdict, 'block', 'top-level verdict must not be block');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T21: planted quote mismatch, quote_fidelity.mode=block coerced to warn (structural guarantee, required case 9)', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    plantQuoteMismatch(tmp);

    const configPath = join(tmp, '.studio', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.gate = config.gate || {};
    config.gate.checks = config.gate.checks || {};
    config.gate.checks.quote_fidelity = { enabled: true, mode: 'block' };
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    const result = spawnGate(tmp, ['--check=quotes', '--json']);
    assert.strictEqual(result.status, 0,
      'quote_fidelity cannot block (structural coercion): exit must be 0; stderr: ' + result.stderr);

    assert.ok(
      result.stderr.includes('quote_fidelity') && result.stderr.includes('coerced'),
      'stderr must carry a coercion notice naming quote_fidelity; got: ' + result.stderr
    );

    const report = readLatestReport(tmp, 'all');
    const qfEntry = report.checks.find(c => c.check === 'quote_fidelity');
    assert.ok(qfEntry, 'quote_fidelity must appear in checks');
    assert.strictEqual(qfEntry.verdict, 'warn',
      'quote_fidelity verdict must be warn even though config requested block; got: ' + qfEntry.verdict);
    assert.notStrictEqual(report.verdict, 'block', 'top-level verdict must never be block for quote_fidelity');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T22: quote_fidelity disabled in config: verdict skip (required case 10)', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const configPath = join(tmp, '.studio', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.gate = config.gate || {};
    config.gate.checks = config.gate.checks || {};
    config.gate.checks.quote_fidelity = { enabled: false, mode: 'warn' };
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    const result = spawnGate(tmp, ['--check=quotes', '--json']);
    assert.strictEqual(result.status, 0, 'disabled check must exit 0; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const qfEntry = report.checks.find(c => c.check === 'quote_fidelity');
    assert.ok(qfEntry, 'quote_fidelity must appear in checks (as skip)');
    assert.strictEqual(qfEntry.verdict, 'skip',
      'quote_fidelity verdict must be skip when disabled; got: ' + qfEntry.verdict);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T22b: quote_fidelity mode=off in config: verdict skip (required case 10, off variant)', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const configPath = join(tmp, '.studio', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.gate = config.gate || {};
    config.gate.checks = config.gate.checks || {};
    config.gate.checks.quote_fidelity = { enabled: true, mode: 'off' };
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    const result = spawnGate(tmp, ['--check=quotes', '--json']);
    assert.strictEqual(result.status, 0, 'mode=off must exit 0; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const qfEntry = report.checks.find(c => c.check === 'quote_fidelity');
    assert.ok(qfEntry, 'quote_fidelity must appear in checks (as skip)');
    assert.strictEqual(qfEntry.verdict, 'skip',
      'quote_fidelity verdict must be skip when mode is off; got: ' + qfEntry.verdict);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T18b: --check=claims, (trailing comma, one real item) still runs the named check', () => {
  // Guards against an over-eager fix: a list with at least one real item must
  // not be rejected just because split(",") produces an empty trailing token.
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnGate(tmp, ['--check=claims,', '--json']);
    assert.strictEqual(result.status, 0,
      '--check=claims, (trailing comma) must still run the claims check; stderr: ' + result.stderr);
    const report = readLatestReport(tmp, 'all');
    const names = report.checks.map(c => c.check);
    assert.ok(names.includes('claim_coverage'), 'claim_coverage must be present');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
