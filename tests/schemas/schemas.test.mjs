// tests/schemas/schemas.test.mjs
// what-it-is:   schema round-trip tests per Q-01 section 4
// what-it-does: tests structured formats in S-08 (schemas and file formats) via the
//               doctor engine and ledger lib: parse a committed valid instance, assert no
//               violations; parse an invalid instance, assert the named finding;
//               assert unknown-field preservation where S-08 Rule 2 applies.
// why:          Q-01 section 4 specifies round-trip coverage for every structured format;
//               one test per format, sized honestly.
// known gap:    ai-use-log.jsonl and style-profile.md have a positive case only. Their
//               former negative cases were deleted because they asserted on literals the
//               test body itself built and drove no repo code, so they could not fail.
//               Neither format has an owning validator to drive, which is the real gap;
//               a test that cannot fail was hiding it rather than covering it.
// runner:       node --test tests/schemas/schemas.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { runChecks, checkSchemaVersion, SUPPORTED_MAJOR } from '../../hooks/lib/doctor-engine.mjs';
import { parseEvidenceLog, serializeEvidenceLog, parseSources } from '../../hooks/lib/ledger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, '..', '..');
const GOLDEN = join(REPO_ROOT, 'examples', 'sample-book');

// ---------------------------------------------------------------------------
// Helper: make a minimal temp bible root from the golden fixture, then overwrite
// the specified file with new content; returns the temp root path.
// The caller is responsible for cleanup via rmSync(dir, {recursive:true}).
// ---------------------------------------------------------------------------

function makeTempBible(fileRelPath, content) {
  const tempDir = mkdtempSync(join(tmpdir(), 'ns-schema-test-'));
  cpSync(GOLDEN, tempDir, { recursive: true });
  const parts = fileRelPath.split('/');
  writeFileSync(join(tempDir, ...parts), content, 'utf8');
  return tempDir;
}

// ---------------------------------------------------------------------------
// 1. progress.json - valid instance round-trip (S-08 Rule 2: unknown fields tolerated)
// ---------------------------------------------------------------------------

test('progress.json: valid instance from golden fixture exits doctor with no progress violations', () => {
  const { findings } = runChecks(GOLDEN);
  const progressFindings = findings.filter(f =>
    f.type && f.type.startsWith('schema.progress')
  );
  assert.deepEqual(progressFindings, [], 'no progress schema violations in golden fixture');
});

test('progress.json: missing required "version" field produces a named finding', () => {
  const invalid = {
    // "version" is intentionally absent
    updated: '2026-07-19T00:00:00Z',
    chapters: [],
    totals: { word_count: 0, open_claim_count: 0, chapters_final: 0, chapters_total: 0 }
  };
  const tempDir = makeTempBible('.studio/progress.json', JSON.stringify(invalid));
  try {
    const { findings } = runChecks(tempDir);
    const vf = findings.filter(f => f.type === 'schema.progress-violation' && f.message.includes('version'));
    assert.ok(vf.length > 0, 'must find a named finding for missing "version" field');
    assert.ok(vf[0].message.includes('version'), 'finding names the "version" field');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('progress.json: unknown-field preservation (S-08 Rule 2) -- extra field does not fail doctor', () => {
  const withExtra = JSON.parse(readFileSync(join(GOLDEN, '.studio', 'progress.json'), 'utf8'));
  withExtra._extra_unknown_field = 'round-trip-sentinel';
  const tempDir = makeTempBible('.studio/progress.json', JSON.stringify(withExtra));
  try {
    const { findings } = runChecks(tempDir);
    const progressFindings = findings.filter(f => f.type === 'schema.progress-violation');
    assert.deepEqual(progressFindings, [], 'unknown extra field must not produce a schema violation (Rule 2)');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. .studio/meta.json - valid instance and schema_version type check
// ---------------------------------------------------------------------------

test('meta.json: valid instance from golden fixture produces no shape-meta violations', () => {
  const { findings } = runChecks(GOLDEN);
  const metaFindings = findings.filter(f => f.type === 'shape.meta-violation');
  assert.deepEqual(metaFindings, [], 'no meta shape violations in golden fixture');
});

test('meta.json: schema_version as a number (not string) produces a named finding', () => {
  const meta = JSON.parse(readFileSync(join(GOLDEN, '.studio', 'meta.json'), 'utf8'));
  meta.schema_version = 2; // number instead of string
  const tempDir = makeTempBible('.studio/meta.json', JSON.stringify(meta));
  try {
    const { findings } = runChecks(tempDir);
    const mf = findings.filter(f =>
      f.type === 'shape.meta-violation' && f.message.includes('schema_version')
    );
    assert.ok(mf.length > 0, 'must find a named finding for non-string schema_version');
    assert.ok(mf[0].message.includes('string'), 'finding names the expected type "string"');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('checkSchemaVersion: supported major "2" returns ok=true', () => {
  const result = checkSchemaVersion({ schema_version: SUPPORTED_MAJOR });
  assert.equal(result.ok, true, 'supported major must return ok=true');
});

// ---------------------------------------------------------------------------
// 3. .studio/config.json - valid instance and gate.mode validation
// ---------------------------------------------------------------------------

test('config.json: valid instance from golden fixture produces no config violations', () => {
  const { findings } = runChecks(GOLDEN);
  const cf = findings.filter(f => f.type === 'shape.config-violation');
  assert.deepEqual(cf, [], 'no config shape violations in golden fixture');
});

test('config.json: unknown gate.mode value produces a named finding', () => {
  const config = JSON.parse(readFileSync(join(GOLDEN, '.studio', 'config.json'), 'utf8'));
  config.gate.mode = 'invalid-blocking-level'; // unknown value
  const tempDir = makeTempBible('.studio/config.json', JSON.stringify(config));
  try {
    const { findings } = runChecks(tempDir);
    const cf = findings.filter(f =>
      f.type === 'shape.config-violation' && f.message.includes('gate.mode')
    );
    assert.ok(cf.length > 0, 'must find a named finding for unknown gate.mode value');
    assert.ok(cf[0].message.includes('invalid-blocking-level'), 'finding names the invalid value');
    assert.ok(
      cf[0].message.includes('off') || cf[0].message.includes('warn') || cf[0].message.includes('block'),
      'finding names the accepted values'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. evidence-log.md - valid instance (ledger lib) and malformed entry
// ---------------------------------------------------------------------------

test('evidence-log.md: valid entries from golden fixture parse cleanly via ledger lib', () => {
  const text = readFileSync(join(GOLDEN, 'research', 'evidence-log.md'), 'utf8');
  const entries = parseEvidenceLog(text);
  assert.ok(entries.length > 0, 'golden fixture must contain at least one EV entry');
  for (const entry of entries) {
    assert.ok(entry.id, 'every entry must have an id');
    assert.ok(entry.claim, 'every entry must have a claim field');
    assert.ok(entry.status, 'every entry must have a status field');
  }
});

test('evidence-log.md: malformed EV entry with missing required field produces a named finding via doctor', () => {
  // Craft a ledger with an entry missing the "confidence" required field
  const badLedger = `# Evidence Log

### EV-0001 (test-claim)
- claim: A test claim that is missing the confidence field.
- source: none
- locator:
- status: pending
- added-by: test
- date: 2026-07-19
`;
  const tempDir = makeTempBible('research/evidence-log.md', badLedger);
  try {
    const { findings } = runChecks(tempDir);
    const ef = findings.filter(f => f.type === 'ev-grammar.malformed-entry');
    assert.ok(ef.length > 0, 'must find a named finding for missing EV required field');
    assert.ok(ef[0].message.includes('confidence') || ef[0].message.includes('EV-0001'), 'finding names the entry');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('evidence-log.md: unknown fields round-trip via ledger lib (S-08 Rule 2)', () => {
  // The EV format is Markdown, not JSON; unknown fields appear as bullet lines.
  // parseEvidenceLog (hooks/lib/ledger.mjs) puts unrecognized bullet keys into
  // entry.extra and records field order in entry._fieldOrder; serializeEvidenceLog
  // must reproduce the unknown field on the way back out. This drives the actual
  // extras mechanism rather than only re-checking that known fields parsed.
  const ledgerWithExtra = `# Evidence Log

### EV-0001 (round-trip-test)
- claim: A test claim used to prove unknown-field round-trip.
- source: none
- locator:
- confidence: low
- status: pending
- added-by: test
- date: 2026-07-19
- reviewed-by: jprisant
`;
  const entries = parseEvidenceLog(ledgerWithExtra);
  assert.equal(entries.length, 1, 'one entry must be parsed');
  assert.equal(
    entries[0].extra['reviewed-by'], 'jprisant',
    'unknown field "reviewed-by" must land in entry.extra, not be dropped'
  );
  const serialized = serializeEvidenceLog(entries);
  assert.ok(
    serialized.includes('- reviewed-by: jprisant'),
    'unknown field must round-trip through serializeEvidenceLog (S-08 Rule 2)'
  );
});

// ---------------------------------------------------------------------------
// 5. .studio/ai-use-log.jsonl - valid instance and missing agent key
// ---------------------------------------------------------------------------

test('ai-use-log.jsonl: every line in the golden fixture is valid JSON with required "agent" field', () => {
  const jsonlText = readFileSync(join(GOLDEN, '.studio', 'ai-use-log.jsonl'), 'utf8');
  const lines = jsonlText.split('\n').filter(l => l.trim() !== '');
  assert.ok(lines.length > 0, 'golden fixture ai-use-log must have at least one entry');
  for (let i = 0; i < lines.length; i++) {
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(lines[i]); }, 'line ' + (i + 1) + ' must parse as JSON');
    assert.ok(Object.prototype.hasOwnProperty.call(parsed, 'agent'), 'line ' + (i + 1) + ' must have "agent" field');
  }
});

// DELETED (test-quality pass, queued at TSK-055 (Tier A check scripts)):
// 'ai-use-log.jsonl: a line missing the required "agent" key is detectable' was
// tautological -- it built a JS object literal in the test body, then asserted a
// property of that same literal (hasOwnProperty('agent') === false). No repo code
// was invoked. Verified there is no owning validator to redirect it to: doctor-engine.mjs
// REQUIRED_PATHS only checks that .studio/ai-use-log.jsonl exists (structure.missing-path);
// it never inspects line content or emits a finding about a missing "agent" field.
// hooks/post-tool-batch.mjs WRITES the agent field but never reads/validates it back.
// docs/formats/ai-use-log.md confirms the only readers are the disclosure-report and
// publish-readiness skills (LLM-driven skill prompts, not deterministic repo code).
// A test that cannot fail is worse than no test, so it is deleted rather than dressed up.

// ---------------------------------------------------------------------------
// 6. context/style-profile.md - valid instance section check
// ---------------------------------------------------------------------------

test('style-profile.md: golden fixture has the required section markers', () => {
  const text = readFileSync(join(GOLDEN, 'context', 'style-profile.md'), 'utf8');
  // Required sections per S-08: ## Voice, ## Diction, ## Rhythm
  // (The style-profile schema requires these headings as mandatory markers.)
  const requiredSections = ['## Voice', '## Diction', '## Rhythm'];
  for (const section of requiredSections) {
    assert.ok(text.includes(section), 'style-profile.md must contain section "' + section + '"');
  }
});

// DELETED (test-quality pass, queued at TSK-055 (Tier A check scripts)):
// 'style-profile.md: absence of required section is detectable via content check' was
// tautological -- it built a template-literal string in the test body, then asserted a
// property of that same string (string.includes('## Voice') === false). No repo code
// was invoked. Verified there is no owning validator to redirect it to: doctor-engine.mjs
// REQUIRED_PATHS only checks that context/style-profile.md exists (structure.missing-path);
// it never inspects section headings or emits a finding about a missing "## Voice" section.
// hooks/lib/orientation.mjs reads style-profile.md but scans for "## Do" / "## Do not"
// bullet rules for the session-start orientation block, fails open (silently omits the
// line) when absent, and does not check for "## Voice", "## Diction", or "## Rhythm" at
// all. The three-section requirement is documented convention (docs/formats/style-profile.md)
// with no runtime enforcement anywhere in the repo. A test that cannot fail is worse than
// no test, so it is deleted rather than dressed up.

// ---------------------------------------------------------------------------
// 7. Gate report (.studio/gate/*.json) - valid instance shape
// ---------------------------------------------------------------------------

test('gate report: golden fixture last-gate.json parses as valid JSON with expected shape', () => {
  const gateReportPath = join(GOLDEN, '.studio', 'gate', 'last-gate.json');
  assert.ok(existsSync(gateReportPath), 'golden fixture must have a last-gate.json');
  const text = readFileSync(gateReportPath, 'utf8');
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(text); }, 'last-gate.json must parse as JSON');
  assert.ok(typeof parsed === 'object' && parsed !== null, 'gate report must be an object');
});

test('gate report: full gate report JSON has verdict, checks, and ts fields', () => {
  const fullReportDir = join(GOLDEN, '.studio', 'gate');
  // Find a full gate report (not last-gate.json, which is a summary)
  const fullReport = join(fullReportDir, '01-listening-before-speaking.20260718T090000Z.json');
  assert.ok(existsSync(fullReport), 'golden fixture must have a full gate report');
  const parsed = JSON.parse(readFileSync(fullReport, 'utf8'));
  assert.ok(typeof parsed.verdict === 'string', 'gate report must have a "verdict" field');
  assert.ok(Array.isArray(parsed.checks), 'gate report must have a "checks" array');
  assert.ok(typeof parsed.ts === 'string', 'gate report must have a "ts" field');
});

// ---------------------------------------------------------------------------
// 8. Snapshot naming conformance - verified by doctor-engine
// ---------------------------------------------------------------------------

test('snapshot naming: golden fixture snapshot passes naming convention', () => {
  const { findings } = runChecks(GOLDEN);
  const sf = findings.filter(f => f.type === 'snapshot.bad-name');
  assert.deepEqual(sf, [], 'golden fixture snapshots must all pass naming convention');
});
