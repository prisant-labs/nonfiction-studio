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
//   P6 GATE TOPOLOGY (ADR-0012 voice verdict scope, Decision 2): two-tier regime dispatch
//   (chapter regime scores each chapter, book regime aggregates), the stub-chapter skip rule,
//   the book-verdict word floor, and the structured `drift` field -- see the section near the
//   end of this file. These call runGate() directly against hand-built synthetic fixtures
//   rather than spawning the CLI, for speed against fixtures large enough to cross the
//   2,200-word book-verdict floor.
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
import { writeSyntheticV5Baseline } from '../lib/synthetic-v5-baseline.mjs';
import { runGate, DEFAULT_GATE, loadGateConfig } from '../../hooks/lib/gate-engine.mjs';
import { measureChapter } from '../../hooks/lib/stylometry-engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EXAMPLES = join(__dirname, '..', '..', 'examples');
const BIN      = join(__dirname, '..', '..', 'bin', 'ns-gate');
const GOLDEN   = join(EXAMPLES, 'sample-book');

// Every committed examples/ fixture still carries a marker_set_version 4 stylometry baseline
// with no calibration ladder, EXCEPT examples/sample-book and examples/fixtures/voice-drift,
// which Task 5 (ADR-0012 implementation wave) recaptured under v5 (independent calibration
// corpora; sample-book measures book regime, voice-drift measures chapter regime -- see
// voice-drift/PLANTED.md). Scoring an un-recaptured fixture with the v5 computeDrift throws
// StaleBaselineError, which -- through the existing, UNCHANGED engine-error handling -- forces
// the WHOLE gate run's exit code to 2, even for a test whose actual subject is claim_coverage,
// continuity, prompt_scrub, or state_coherence, not stylometry at all. makeTempClone below
// patches every clone with a synthetic, self-consistent v5 baseline (measured from the clone's
// own current chapters/*.md, so every marker's z is 0 on unchanged content) BY DEFAULT, so a test
// whose subject is something other than stylometry is not collaterally blocked by a fixture still
// pending recapture. A test whose own subject IS a real committed fixture's own baseline and
// planted content (T05, the WORDING CONTRACT exceeds-case, and T07's voice-drift leg) opts out
// via { keepRealBaseline: true } -- see each one's own comment.
function makeTempClone(sourceDir, opts = {}) {
  const base = join(os.tmpdir(), 'ns-gate-test');
  mkdirSync(base, { recursive: true });
  const tmpDir = mkdtempSync(base + '/clone-');
  cpSync(sourceDir, tmpDir, { recursive: true });
  if (!opts.keepRealBaseline) {
    writeSyntheticV5Baseline(tmpDir);
  }
  return tmpDir;
}

// The three tests below (T05, the WORDING CONTRACT exceeds-case, and T07's voice-drift leg)
// whose own subject is the REAL committed voice-drift fixture's planted defect actually blocking
// through the gate are un-skipped as of the coordinator's ruling (ADR-0012 implementation wave,
// Task 5 continuation): voice-drift now carries its own real, calibrated v5 baseline (its own
// independent corpus, first-person-rich and contraction-rich, calibrating to regime "chapter" --
// see PLANTED.md), so the gate's chapter-regime path (no book-scale word floor; each chapter
// scored and judged on its own) reaches the planted chapter's block honestly. The book-regime
// floor that made this structurally unreachable under the sample book's shared, sparser voice no
// longer applies -- this fixture demonstrates the OTHER regime.

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

/** Writes .claude/nonfiction-studio.local.md under tmpDir with the given raw text content
 * (Wave 1 exit Task 2: per-project studio settings file). */
function writeSettingsFile(tmpDir, text) {
  const settingsDir = join(tmpDir, '.claude');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, 'nonfiction-studio.local.md'), text, 'utf8');
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

    // Schema-exact per-check keys: check, verdict, detail, evidence, next -- with ONE named
    // exception (ADR-0012 voice verdict scope, Decision 2, PF-14): the stylometry entry alone
    // also carries a structured `drift` sibling to `detail`. gate-report `version` stays 2 for
    // this addition (this implementation wave's report-version ruling): it is additive and no
    // validator anywhere asserts the check-entry key set exhaustively except this test itself.
    for (const entry of report.checks) {
      const ck = Object.keys(entry).sort();
      const expected = entry.check === 'stylometry'
        ? ['check', 'detail', 'drift', 'evidence', 'next', 'verdict']
        : ['check', 'detail', 'evidence', 'next', 'verdict'];
      assert.deepStrictEqual(
        ck, expected,
        'per-check keys must be exactly: ' + expected.join(', ') + ' on "' + entry.check + '"'
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

// This test's own subject is the REAL committed voice-drift fixture's planted defect actually
// blocking, not merely "some check finds something" -- exactly the "fixture's real baseline is
// the test's substance" case makeTempClone's own comment names, so it opts out of the synthetic
// baseline patch via { keepRealBaseline: true }. Un-skipped per the coordinator's ruling (ADR-0012
// implementation wave, Task 5 continuation): the fixture now carries its own calibrated v5
// baseline (chapter regime; see PLANTED.md), so the planted chapter (chapters/02-finding-your-
// network.md) blocks through the gate's floor-free chapter-regime path with real margin
// (statistic 13.62 vs threshold 3.52).
test('T05: voice-drift block clone: exit 1; stylometry block; drift-threshold in detail with score and threshold', () => {
  const tmp = makeTempClone(join(EXAMPLES, 'fixtures', 'voice-drift'), { keepRealBaseline: true });
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

// ---- WORDING CONTRACT: stylometry detail phrasing, pinned at the writer -------
// hooks/lib/status-engine.mjs (the ns-status engine) recovers the numeric drift statistic by
// PREFERRING the structured `drift.statistic` field since ADR-0012 (voice verdict scope,
// Decision 2, PF-14); the prose fallback (DRIFT_SCORE_PATTERN) still exists for a report written
// before that field existed, so the literal prose phrasing pinned here still matters for that
// path. These tests pin the LITERAL phrasing this engine emits, against real spawned ns-gate
// output (never a synthetic string), so a future rewording fails loudly here at the writer
// instead of silently degrading every reader to null.

test('WORDING CONTRACT: stylometry pass-case (book regime, below the word floor) detail names the floor in plain language', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 0,
      'golden book warn mode must exit 0; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const styloEntry = report.checks.find(c => c.check === 'stylometry');
    assert.ok(styloEntry, 'stylometry check must be present in report');
    assert.strictEqual(styloEntry.verdict, 'pass', 'stylometry must pass on the golden book');

    // The golden book's own aggregate (1055 scored words per the committed fixture) is well
    // below MIN_BOOK_VERDICT_WORDS (2200), and the synthetic patched clone's baseline is book
    // regime (P9: the sample book's own sparse first-person rate genuinely lands it there), so
    // this is the floor-advice detail, not a "statistic within threshold" one.
    assert.match(
      styloEntry.detail,
      /^book-scale verdict only: \d+ scored word\(s\) is below the 2200-word floor a supportable book-scale verdict needs; reporting for advice only, never blocking below the floor$/,
      'pass-case (below-floor) detail must literally name the floor; got: ' + styloEntry.detail
    );
    assert.strictEqual(styloEntry.drift.regime, 'book');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// This test's own subject is the REAL committed voice-drift fixture's planted defect actually
// blocking through the gate. Un-skipped for the same reason as T05 above: the fixture now
// carries its own calibrated v5, chapter-regime baseline, so the planted chapter blocks with
// real margin instead of being structurally unreachable under a book-regime word floor.
test('WORDING CONTRACT: stylometry exceeds-case detail literally names the worst marker and the gate-coined token', () => {
  const tmp = makeTempClone(join(EXAMPLES, 'fixtures', 'voice-drift'), { keepRealBaseline: true });
  try {
    writeBlockConfig(tmp);
    const result = spawnGate(tmp, ['--json']);
    assert.strictEqual(result.status, 1,
      'voice-drift block mode must exit 1; stderr: ' + result.stderr);

    const report = readLatestReport(tmp, 'all');
    const styloEntry = report.checks.find(c => c.check === 'stylometry');
    assert.ok(styloEntry, 'stylometry check must be present in report');
    assert.strictEqual(styloEntry.verdict, 'block', 'stylometry must block on the voice-drift fixture');

    assert.match(
      styloEntry.detail,
      /exceeds threshold \d+(?:\.\d+)?; stylometry\.drift-threshold$/,
      'exceeds-case detail must exceed a threshold and carry the gate-coined token; got: ' + styloEntry.detail
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
  ['continuity-error', join(EXAMPLES, 'fixtures', 'continuity-error'), false],
  // voice-drift's ONLY defect is the planted register shift; its "warn" verdict here comes
  // entirely from stylometry finding it, so (unlike continuity-error and ai-injection, which
  // carry their own non-stylometry findings) this leg cannot be proven with a synthetic
  // baseline patched to pass -- it is squarely the "fixture's real baseline is the test's
  // substance" case, the same as T05 and the WORDING CONTRACT exceeds-case above. Un-skipped
  // per the coordinator's ruling (ADR-0012 implementation wave, Task 5 continuation): the
  // fixture's own calibrated v5, chapter-regime baseline blocks the planted chapter with real
  // margin, so the fixture's own (warn) gate mode correctly reports top-level verdict warn.
  ['voice-drift',      join(EXAMPLES, 'fixtures', 'voice-drift'), true],
  ['ai-injection',     join(EXAMPLES, 'fixtures', 'ai-injection'), false],
];

for (const [label, fixtureDir, keepRealBaseline] of BROKEN_WARN_FIXTURES) {
  test('T07: ' + label + ' warn mode: exit 0 with top-level verdict warn', () => {
    const tmp = makeTempClone(fixtureDir, { keepRealBaseline });
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

// ============================================================================
// Wave 1 exit Task 2 (settings engine): template parity + settings overlay
// ============================================================================

const TEMPLATES = join(__dirname, '..', '..', 'templates');

// ---- Template parity: both shipped config templates must carry the full default check set --

test('template parity: templates/config-defaults.json gate.checks key set deeply equals Object.keys(DEFAULT_GATE.checks)', () => {
  const configDefaults = JSON.parse(readFileSync(join(TEMPLATES, 'config-defaults.json'), 'utf8'));
  const actual = Object.keys(configDefaults.gate.checks).sort();
  const expected = Object.keys(DEFAULT_GATE.checks).sort();
  assert.deepStrictEqual(
    actual, expected,
    'templates/config-defaults.json gate.checks keys must match DEFAULT_GATE.checks exactly; got: ' +
    JSON.stringify(actual) + '; expected: ' + JSON.stringify(expected)
  );
});

test('template parity: templates/book-scaffold/.studio/config.json gate.checks key set deeply equals Object.keys(DEFAULT_GATE.checks)', () => {
  const scaffoldConfig = JSON.parse(
    readFileSync(join(TEMPLATES, 'book-scaffold', '.studio', 'config.json'), 'utf8')
  );
  const actual = Object.keys(scaffoldConfig.gate.checks).sort();
  const expected = Object.keys(DEFAULT_GATE.checks).sort();
  assert.deepStrictEqual(
    actual, expected,
    'templates/book-scaffold/.studio/config.json gate.checks keys must match DEFAULT_GATE.checks exactly; got: ' +
    JSON.stringify(actual) + '; expected: ' + JSON.stringify(expected)
  );
});

// ---- settings gate_mode override: raises exit code without promoting a coerced check -----

// Uses the ai-injection fixture UNMODIFIED (same fixture T06/T07 already prove the "before"
// half of this comparison with: T07 shows the raw fixture's own gate.mode "warn" caps the real
// prompt_scrub finding to a top-level "warn" verdict, exit 0). This test additionally plants
// quote_fidelity.mode=block in config.json (an already-coerced check, alongside prompt_scrub's
// own real, unrelated finding) and, on the settings side, both the one lever P2 actually exposes
// (gate_mode) and an inert nested "gate: {checks: {quote_fidelity: {mode: block}}}" shape that
// loadGateConfig never reads (P2's settings schema has no per-check key) -- covering "every
// merge layer that exists" per the acceptance criteria, not only the one the schema documents.
test('Wave 1 exit Task 2: settings gate_mode: block flips a real finding from capped-warn to exit 1, while quote_fidelity stays coerced through every layer (config block + settings gate_mode + an inert nested settings shape)', () => {
  const tmp = makeTempClone(join(EXAMPLES, 'fixtures', 'ai-injection'));
  try {
    // Plant a REAL quote-fidelity mismatch (reusing the same helper T20/T21 use against GOLDEN):
    // without an actual finding, quote_fidelity trivially reports "pass" regardless of mode, and
    // the coercion-holds assertion below would prove nothing.
    plantQuoteMismatch(tmp);

    const configPath = join(tmp, '.studio', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.gate.checks.quote_fidelity = { enabled: true, mode: 'block' };
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    // Before settings: gate.mode is "warn" (the fixture's own default), so D-03 Invariant 2
    // caps the real prompt_scrub block finding to a top-level "warn" verdict -- exit 0.
    const before = spawnGate(tmp, ['--json']);
    assert.strictEqual(before.status, 0,
      'before settings: capped to warn, exit 0; stderr: ' + before.stderr);
    const beforeReport = readLatestReport(tmp, 'all');
    assert.strictEqual(beforeReport.verdict, 'warn', 'before settings: top-level verdict is warn');

    writeSettingsFile(tmp, [
      '---',
      'gate_mode: block',
      'gate:',
      '  checks:',
      '    quote_fidelity:',
      '      mode: block',
      '---',
      '',
    ].join('\n'));

    const after = spawnGate(tmp, ['--json']);
    assert.strictEqual(after.status, 1,
      'settings gate_mode: block must flip the same real finding to exit 1; stderr: ' + after.stderr);

    const report = readLatestReport(tmp, 'all');
    assert.strictEqual(report.verdict, 'block', 'top-level verdict must be block once settings raises gate.mode');

    const scrubEntry = report.checks.find(c => c.check === 'prompt_scrub');
    assert.strictEqual(scrubEntry.verdict, 'block', 'prompt_scrub (the real, non-coerced finding) drives the block');

    const qfEntry = report.checks.find(c => c.check === 'quote_fidelity');
    assert.strictEqual(
      qfEntry.verdict, 'warn',
      'quote_fidelity must stay coerced to warn even under config block + settings gate_mode: block + ' +
      'an inert nested settings shape; got: ' + qfEntry.verdict
    );

    assert.ok(
      after.stderr.includes('quote_fidelity') && after.stderr.includes('coerced'),
      'stderr must still carry the quote_fidelity structural coercion notice; got: ' + after.stderr
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- settings thresholds: shallow merge, settings wins on collision -----------------------

test('Wave 1 exit Task 2: settings thresholds shallow-merges over config thresholds -- settings wins on a colliding key, a settings-only key is added, a config-only key survives untouched', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    // GOLDEN's own .studio/config.json thresholds: { claim_coverage_min: 1.0, stylometry_marker_tolerance: 2.0 }
    writeSettingsFile(tmp, [
      '---',
      'thresholds:',
      '  stylometry_marker_tolerance: 9.5',
      '  overlap_min_words: 15',
      '---',
    ].join('\n'));

    const { thresholds } = loadGateConfig(tmp);
    assert.strictEqual(thresholds.stylometry_marker_tolerance, 9.5, 'settings must win on a colliding key');
    assert.strictEqual(thresholds.overlap_min_words, 15, 'a settings-only key must be added');
    assert.strictEqual(
      thresholds.claim_coverage_min, 1.0,
      'a config-only key not named in settings must pass through unchanged'
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- corrupt settings vs. absent settings: identical gate behavior, warning-only difference

test('Wave 1 exit Task 2: corrupt settings never changes gate behavior vs. no settings -- identical reports (ts aside), warning appears on stderr only for the corrupt run', () => {
  const tmpAbsent = makeTempClone(GOLDEN);
  const tmpCorrupt = makeTempClone(GOLDEN);
  try {
    writeSettingsFile(tmpCorrupt, '---\ngate_mode: [off, warn\n---\n'); // invalid YAML

    const resultAbsent = spawnGate(tmpAbsent, ['--json']);
    const resultCorrupt = spawnGate(tmpCorrupt, ['--json']);

    assert.strictEqual(
      resultAbsent.status, resultCorrupt.status,
      'exit codes must be identical; absent stderr: ' + resultAbsent.stderr + ' corrupt stderr: ' + resultCorrupt.stderr
    );

    const stripTs = r => {
      const clone = JSON.parse(JSON.stringify(r));
      delete clone.ts;
      return clone;
    };
    const reportAbsent = readLatestReport(tmpAbsent, 'all');
    const reportCorrupt = readLatestReport(tmpCorrupt, 'all');
    assert.deepStrictEqual(
      stripTs(reportCorrupt), stripTs(reportAbsent),
      'corrupt settings must produce an IDENTICAL report (ts aside) to no settings at all'
    );

    assert.ok(
      !resultAbsent.stderr.includes('settings warning'),
      'no settings file: no settings warning on stderr; got: ' + resultAbsent.stderr
    );
    assert.ok(
      resultCorrupt.stderr.includes('settings warning'),
      'corrupt settings file: a settings warning must appear on stderr; got: ' + resultCorrupt.stderr
    );
    assert.ok(
      resultCorrupt.stderr.includes(join(tmpCorrupt, '.claude', 'nonfiction-studio.local.md')),
      'the warning must name the corrupt settings file path; got: ' + resultCorrupt.stderr
    );
  } finally {
    rmSync(tmpAbsent, { recursive: true, force: true });
    rmSync(tmpCorrupt, { recursive: true, force: true });
  }
});

// ============================================================================
// P6 GATE TOPOLOGY (ADR-0012 voice verdict scope, Decision 2; PF-14 structured drift field)
// ============================================================================
//
// Hand-built fixtures, not committed examples/ fixtures: every test here calls runGate()
// directly against a temp book root this section constructs, using SCENARIOS.md's own
// methodology (tests/engines/fixtures/drift-scenarios/SCENARIOS.md: substitute contractions
// out, disturbing everything else as little as possible) to move exactly one marker
// (contraction_rate) by a hand-computable amount:
//
//   SENTENCE_BLOCK has ten sentences, five carrying one contraction each (don't, can't, won't,
//   isn't, I'm/we'll x2, we're x2, don't, can't, it's x2 -- fourteen contraction tokens total
//   per block). repeatedProse(n) repeats it n times (deterministic, no RNG); expandContractions
//   replaces every one of those tokens with its non-apostrophe form (case-insensitive, so a
//   sentence-leading "It's"/"I'm" is caught the same as a mid-sentence one) -- after expansion,
//   CONTRACTION_RE (hooks/lib/stylometry-engine.mjs) matches nothing at all, so the expanded
//   text's own contraction_rate is exactly 0, verified directly below rather than assumed.
//
// A chapter's own baseline is built from measureChapter(cleanText) -- so a chapter scored
// against ITSELF has every marker's relDev exactly 0 (z = 0, trivially not exceeded) -- while
// the expanded sibling's contraction_rate relDev against that same baseline is exactly -100%
// (baseline nonzero, measured 0: a zero-baseline collapse, the same shape Task 3's own
// "computeDrift v5: a blocking case" test uses). The calibration ladder below gives
// contraction_rate a tight noise scale (1.0) and every other marker a generous one (50.0), so
// only the deliberately manipulated marker can cross the 3.0 block_threshold; two rungs only,
// both carrying IDENTICAL values, so which side of the ladder a fixture's word count clamps to
// never changes the answer -- this suite is about gate topology, not the ladder lookup itself
// (already proven in tests/engines/stylometry.test.mjs).

const SENTENCE_BLOCK =
  "I don't think it's ready yet. We can't decide alone. They won't wait forever. " +
  "It isn't easy, but we'll manage. I'm certain we'll find a way. We're doing what we can. " +
  "It's fine, and we're ready. I don't mind waiting. We can't rush it. It's the right call. ";

function repeatedProse(n) {
  return SENTENCE_BLOCK.repeat(n);
}

function expandContractions(text) {
  return text
    .replace(/don't/gi, 'do not').replace(/isn't/gi, 'is not').replace(/won't/gi, 'will not')
    .replace(/can't/gi, 'cannot').replace(/it's/gi, 'it is').replace(/we'll/gi, 'we will')
    .replace(/i'm/gi, 'I am').replace(/we're/gi, 'we are');
}

// A stub/empty chapter file -- a normal, modeled state on a fresh book (scaffolding before the
// author has written anything) -- well under MIN_SCORABLE_CHAPTER_WORDS (50).
const STUB_TEXT = 'TODO: write this chapter.';

const TOPOLOGY_MARKER_NAMES = [
  'function_word_rate', 'contraction_rate', 'first_person_rate', 'second_person_rate',
  'type_token_ratio', 'avg_word_length', 'avg_sentence_length', 'punctuation_rate',
];

function topologyScales(contractionScale) {
  const scales = {};
  for (const marker of TOPOLOGY_MARKER_NAMES) {
    scales[marker] = marker === 'contraction_rate' ? contractionScale : 50.0;
  }
  return scales;
}

function buildTopologyCalibration(regime) {
  return {
    spans: [550, 2200],
    noise_scales: { '550': topologyScales(1.0), '2200': topologyScales(1.0) },
    block_thresholds: { '550': 3.0, '2200': 3.0 },
    detectability_auc: regime === 'chapter' ? 0.98 : 0.70,
    regime,
    replicates: 300,
    seed: 4242,
  };
}

function buildTopologyBaseline(markers, regime) {
  return {
    markers,
    marker_set_version: 5,
    captured: '2026-08-30T00:00:00Z',
    sample_count: 1,
    calibration: buildTopologyCalibration(regime),
  };
}

/**
 * Builds a temp book root with .studio/config.json (stylometry-only gate, block mode, plus the
 * given baseline) and chapters/<NN>-chapter.md for each given text, in order. Only the
 * stylometry check is ever requested (via runGate's checkSubset), so no other check's own
 * fixture requirements (evidence-log.md, etc.) apply here.
 */
function makeTopologyBook(baseline, chapterTexts) {
  const dir = mkdtempSync(join(os.tmpdir(), 'ns-gate-topology-'));
  mkdirSync(join(dir, '.studio'), { recursive: true });
  mkdirSync(join(dir, 'chapters'), { recursive: true });
  const config = {
    version: 2,
    gate: {
      mode: 'block',
      checks: {
        stylometry: { enabled: true, mode: 'block' },
        session_write_flag: { enabled: true, mode: 'block' },
      },
    },
    thresholds: {},
    stylometry: { baseline },
  };
  writeFileSync(join(dir, '.studio', 'config.json'), JSON.stringify(config, null, 2), 'utf8');
  chapterTexts.forEach((text, i) => {
    const slug = String(i + 1).padStart(2, '0') + '-chapter';
    writeFileSync(join(dir, 'chapters', slug + '.md'), text, 'utf8');
  });
  return dir;
}

function runTopologyGate(dir) {
  const { report } = runGate(dir, { checkSubset: ['stylometry'] });
  return report.checks.find(c => c.check === 'stylometry');
}

// Sanity checks on the fixture-construction claims made in the comment block above, run once
// so every test below can rely on them without re-deriving.
test('P6 fixture sanity: expandContractions leaves exactly zero contraction tokens (CONTRACTION_RE finds none)', () => {
  const clean = repeatedProse(4);
  const expanded = expandContractions(clean);
  assert.strictEqual(measureChapter(expanded).contraction_rate, 0,
    'expanded text must measure contraction_rate exactly 0');
  assert.notStrictEqual(measureChapter(clean).contraction_rate, 0,
    'unexpanded text must measure a nonzero contraction_rate (precondition for the -100% relDev)');
});

// ---- Chapter regime: exactly one of two chapters exceeds ---------------------------------

test('P6 chapter regime: exactly one chapter exceeds -> block verdict, evidence names only the offending file, drift.per_chapter carries both', () => {
  const cleanText = repeatedProse(4); // 248 words
  const expandedText = expandContractions(cleanText); // 240 words, contraction_rate 0
  const baseline = buildTopologyBaseline(measureChapter(cleanText), 'chapter');
  const dir = makeTopologyBook(baseline, [cleanText, expandedText]);
  try {
    const entry = runTopologyGate(dir);
    assert.strictEqual(entry.verdict, 'block',
      'deriveVerdict(mode="block", anyExceeded=true) must be "block"; got: ' + entry.verdict);
    assert.deepStrictEqual(entry.evidence, ['chapters/02-chapter.md'],
      'evidence must list only the offending (expanded) chapter file; got: ' + JSON.stringify(entry.evidence));
    assert.strictEqual(entry.drift.regime, 'chapter');
    assert.strictEqual(entry.drift.per_chapter.length, 2, 'drift.per_chapter must carry BOTH chapters');
    const files = entry.drift.per_chapter.map(c => c.file).sort();
    assert.deepStrictEqual(files, ['chapters/01-chapter.md', 'chapters/02-chapter.md']);
    assert.strictEqual(entry.drift.worst_chapter, 'chapters/02-chapter.md');
    assert.strictEqual(entry.drift.worst_marker, 'contraction_rate');
    assert.deepStrictEqual(entry.drift.skipped, []);
    assert.ok(entry.detail.includes('stylometry.drift-threshold'),
      'detail must carry the gate-coined token on a block; got: ' + entry.detail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Chapter regime: "worst" is ranked by threshold ratio, not raw statistic -------------
//
// Review round 1, Finding 2 (latent correctness bug): thresholds are resolved PER CHAPTER from
// the calibration ladder (log-linear on that chapter's own scoredWords), so a shorter chapter
// can carry a materially different threshold than a longer one. A raw-statistic argmax can then
// pick a chapter that never exceeded its OWN threshold over one that did -- masked until now
// because every other fixture in this file uses IDENTICAL thresholds across rungs.
//
// This fixture gives contraction_rate a tight, span-invariant noise scale (2.0) so it always
// dominates the statistic (other markers get a generous 50.0, as in topologyScales), but makes
// the two rungs' block_thresholds genuinely different (60.0 at 250 words, 10.0 at 3000 words):
//   - chapterA: EVERY contraction expanded (relDev -100%), SHORT (240 words, clamps to the
//     250-word rung) -> statistic 50.0, threshold 60.0 -> does NOT exceed.
//   - chapterB: only "don't"/"isn't"/"won't" expanded (a smaller relDev, ~-28.57%), LONG (3,720
//     words, clamps to the 3000-word rung) -> statistic ~14.29, threshold 10.0 -> DOES exceed.
// Raw-statistic argmax picks chapterA (50.0 > 14.29) -- a non-exceeding chapter -- as "worst",
// which would print a self-contradictory "statistic < threshold" sentence on the exceeds branch
// and point drift.worst_chapter/worst_marker at the wrong chapter. Ranking by statistic/
// threshold ratio (chapterA: 50/60 = 0.83; chapterB: 14.29/10 = 1.43) correctly picks chapterB.

function partialExpandContractions(text) {
  return text
    .replace(/don't/gi, 'do not').replace(/isn't/gi, 'is not').replace(/won't/gi, 'will not');
}

function buildRatioCalibration() {
  return {
    spans: [250, 3000],
    noise_scales: { '250': topologyScales(2.0), '3000': topologyScales(2.0) },
    block_thresholds: { '250': 60.0, '3000': 10.0 },
    detectability_auc: 0.98,
    regime: 'chapter',
    replicates: 300,
    seed: 4242,
  };
}

function buildRatioBaseline(markers) {
  return {
    markers,
    marker_set_version: 5,
    captured: '2026-08-30T00:00:00Z',
    sample_count: 1,
    calibration: buildRatioCalibration(),
  };
}

test('P6 chapter regime: worst-chapter selection ranks by statistic/threshold ratio, so a lower-statistic chapter that exceeds its own threshold is chosen over a higher-statistic chapter that does not; detail names the worst chapter and its marker', () => {
  const cleanText = repeatedProse(4);
  const baseline = buildRatioBaseline(measureChapter(cleanText));

  const chapterAText = expandContractions(cleanText); // 240 words -> clamps to the 250 rung
  const chapterBText = partialExpandContractions(SENTENCE_BLOCK).repeat(60); // 3,720 words -> clamps to the 3000 rung

  const dir = makeTopologyBook(baseline, [chapterAText, chapterBText]);
  try {
    const entry = runTopologyGate(dir);

    assert.strictEqual(entry.drift.per_chapter.length, 2, 'both chapters must be scored');
    const [statA, statB] = entry.drift.per_chapter.map(c => c.statistic);
    assert.ok(statA > statB,
      'fixture precondition: chapter A (index 0) must carry the HIGHER raw statistic; got A=' +
      statA + ' B=' + statB);

    // Verdict and evidence: only chapterB (the actual exceeder) drives the block.
    assert.strictEqual(entry.verdict, 'block',
      'chapterB exceeds its own (lower) threshold; verdict must be block; got: ' + entry.verdict);
    assert.deepStrictEqual(entry.evidence, ['chapters/02-chapter.md'],
      'evidence must name only chapterB, the actual exceeder; got: ' + JSON.stringify(entry.evidence));

    // The bug under test: worst_chapter must be the EXCEEDING chapter (B), not the
    // higher-raw-statistic one (A).
    assert.strictEqual(entry.drift.worst_chapter, 'chapters/02-chapter.md',
      'worst_chapter must be ranked by statistic/threshold ratio, not raw statistic; got: ' +
      entry.drift.worst_chapter);
    assert.strictEqual(entry.drift.worst_marker, 'contraction_rate');
    assert.strictEqual(entry.drift.statistic, statB, 'drift.statistic must be chapterB\'s own statistic');
    assert.strictEqual(entry.drift.threshold, 10.0, 'drift.threshold must be chapterB\'s own (lower) threshold');

    // Finding 1: the exceeds-branch detail must name the worst chapter, its worst marker, its
    // statistic, and the threshold -- and the numbers must be internally consistent (no
    // "statistic < threshold" on an exceeds sentence).
    assert.ok(entry.detail.includes('chapters/02-chapter.md'),
      'detail must name the worst (exceeding) chapter; got: ' + entry.detail);
    assert.ok(entry.detail.includes('contraction_rate'),
      'detail must name the worst marker; got: ' + entry.detail);
    assert.match(entry.detail, /exceeds threshold \d+(?:\.\d+)?; stylometry\.drift-threshold$/,
      'detail must carry an internally-consistent exceeds sentence; got: ' + entry.detail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Chapter regime: stub-chapter skip rule -----------------------------------------------

test('P6 chapter regime: a stub chapter (under 50 words) is skipped, listed in drift.skipped, and never crashes or drives the verdict', () => {
  const cleanText = repeatedProse(4); // 248 words, matches its own baseline: z = 0 everywhere
  const baseline = buildTopologyBaseline(measureChapter(cleanText), 'chapter');
  const dir = makeTopologyBook(baseline, [cleanText, STUB_TEXT]);
  try {
    const entry = runTopologyGate(dir);
    assert.strictEqual(entry.verdict, 'pass',
      'the only scorable chapter matches its own baseline; verdict must be pass; got: ' + entry.verdict);
    assert.strictEqual(entry.drift.skipped.length, 1);
    assert.strictEqual(entry.drift.skipped[0].file, 'chapters/02-chapter.md');
    assert.match(entry.drift.skipped[0].reason, /below 50 scorable words/);
    assert.strictEqual(entry.drift.per_chapter.length, 1, 'the stub must not appear in per_chapter');
    assert.strictEqual(entry.drift.worst_chapter, 'chapters/01-chapter.md');
    // Review round 1, Finding 1: the pass-branch detail must also name the worst marker (every
    // marker ties at z=0 here; ties break to Object.keys(markers)[0], the first ratiosFromCounts
    // key, function_word_rate -- see stylometry-engine.mjs's worstMarker tie-break comment).
    assert.strictEqual(entry.drift.worst_marker, 'function_word_rate');
    assert.ok(entry.detail.includes('function_word_rate'),
      'pass-branch detail must name the worst marker; got: ' + entry.detail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P6 chapter regime: an all-stubs book passes with advisory detail and never crashes', () => {
  const baseline = buildTopologyBaseline(measureChapter(repeatedProse(4)), 'chapter');
  const dir = makeTopologyBook(baseline, [STUB_TEXT]);
  try {
    const entry = runTopologyGate(dir);
    assert.strictEqual(entry.verdict, 'pass', 'all-skipped must pass, same as the no-chapters case');
    assert.strictEqual(entry.drift.skipped.length, 1);
    assert.deepStrictEqual(entry.drift.per_chapter, []);
    assert.strictEqual(entry.drift.worst_chapter, null);
    assert.strictEqual(entry.drift.statistic, null);
    assert.match(entry.detail, /no scorable chapters/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Book regime: the SAME two-chapter fixture, aggregate-only verdict --------------------

test('P6 book regime: the same two-chapter fixture -> verdict from the aggregate only, per-chapter entries present as advice, detail names book-scale', () => {
  const cleanText = repeatedProse(4);
  const expandedText = expandContractions(cleanText);
  // Book regime's aggregate baseline is the SAME clean-chapter vector (not the aggregate of
  // both) -- measureBook([clean, expanded]) will therefore NOT match this baseline exactly,
  // unlike the chapter-regime fixture above where each chapter is judged against its own match.
  const baseline = buildTopologyBaseline(measureChapter(cleanText), 'book');
  const dir = makeTopologyBook(baseline, [cleanText, expandedText]);
  try {
    const entry = runTopologyGate(dir);
    assert.strictEqual(entry.drift.regime, 'book');
    assert.strictEqual(entry.drift.per_chapter.length, 2, 'per-chapter entries are present as advice');
    // 248 + 240 = 488 aggregate scored words, well below the 2,200-word floor -- pass-with-
    // advice regardless of the aggregate's own statistic (proven exceeding the threshold by
    // the dedicated floor test below).
    assert.strictEqual(entry.verdict, 'pass');
    assert.match(entry.detail, /^book-scale /, 'detail must name book-scale in plain language');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Book regime: the word floor -----------------------------------------------------------

test('P6 book regime: below the 2,200-word floor -> pass-with-advice even though the aggregate statistic itself would exceed', () => {
  const cleanText = repeatedProse(4);
  const expandedText = expandContractions(cleanText);
  const baseline = buildTopologyBaseline(measureChapter(cleanText), 'book');
  const dir = makeTopologyBook(baseline, [cleanText, expandedText]);
  try {
    const entry = runTopologyGate(dir);
    assert.strictEqual(entry.verdict, 'pass', 'never a block below the floor');
    // The aggregate's own contraction_rate relDev is exactly -50% (half the sentences carry a
    // contraction, half do not, after mixing one clean and one fully-expanded chapter); with
    // this fixture's noise scale of 1.0, that is |z| = 50, far past the 3.0 threshold this
    // same statistic is reported alongside -- proving the floor, not a coincidentally-passing
    // statistic, is what suppresses the block.
    assert.ok(entry.drift.statistic > entry.drift.threshold,
      'the aggregate statistic must itself exceed the threshold (floor is what suppresses the block); statistic=' +
      entry.drift.statistic + ' threshold=' + entry.drift.threshold);
    assert.match(entry.detail, /below the 2200-word floor/, 'the floor must be named in the detail');
    assert.deepStrictEqual(entry.evidence, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P6 book regime: at or above the 2,200-word floor -> blocking derives from the aggregate normally', () => {
  const cleanText = repeatedProse(60); // 3,720 words
  const expandedText = expandContractions(cleanText); // 3,600 words; aggregate 7,320
  const baseline = buildTopologyBaseline(measureChapter(cleanText), 'book');
  const dir = makeTopologyBook(baseline, [cleanText, expandedText]);
  try {
    const entry = runTopologyGate(dir);
    assert.strictEqual(entry.verdict, 'block',
      'at 7,320 aggregate scored words (above the 2,200 floor), the same -50% relDev must block; got: ' +
      entry.verdict);
    assert.ok(entry.drift.statistic >= entry.drift.threshold);
    assert.ok(entry.detail.includes('stylometry.drift-threshold'));
    assert.deepStrictEqual(entry.evidence, ['chapters/01-chapter.md', 'chapters/02-chapter.md'],
      'book-regime block evidence lists every scored chapter file (the aggregate, not one chapter, drove the verdict)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- The structured drift field's shape, exactly -------------------------------------------

test('P6 structured drift field: keys match P14/P6\'s shape exactly, and per_chapter/skipped entry shapes match', () => {
  const cleanText = repeatedProse(4);
  const stub = STUB_TEXT;
  const baseline = buildTopologyBaseline(measureChapter(cleanText), 'chapter');
  const dir = makeTopologyBook(baseline, [cleanText, stub]);
  try {
    const entry = runTopologyGate(dir);
    const driftKeys = Object.keys(entry.drift).sort();
    assert.deepStrictEqual(
      driftKeys,
      ['per_chapter', 'regime', 'skipped', 'statistic', 'threshold', 'worst_chapter', 'worst_marker'],
      'drift field keys must match P6\'s shape exactly; got: ' + JSON.stringify(driftKeys)
    );
    for (const c of entry.drift.per_chapter) {
      assert.deepStrictEqual(Object.keys(c).sort(), ['file', 'statistic', 'worst_marker']);
      assert.strictEqual(typeof c.statistic, 'number', 'per_chapter statistic must be a number, not a string');
    }
    for (const s of entry.drift.skipped) {
      assert.deepStrictEqual(Object.keys(s).sort(), ['file', 'reason']);
    }
    assert.strictEqual(typeof entry.drift.statistic, 'number');
    assert.strictEqual(typeof entry.drift.threshold, 'number');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- P7 deprecation surfaced in the gate detail, once per run ------------------------------

test('P7: thresholds.drift_score_max present -> the retirement notice is appended to the stylometry detail once', () => {
  const cleanText = repeatedProse(4);
  const baseline = buildTopologyBaseline(measureChapter(cleanText), 'chapter');
  const dir = makeTopologyBook(baseline, [cleanText]);
  const configPath = join(dir, '.studio', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.thresholds.drift_score_max = 25;
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  try {
    const entry = runTopologyGate(dir);
    const notice = 'thresholds.drift_score_max is retired by the calibrated-null verdict and is ignored';
    const occurrences = entry.detail.split(notice).length - 1;
    assert.strictEqual(occurrences, 1, 'the notice must appear exactly once; got detail: ' + entry.detail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
