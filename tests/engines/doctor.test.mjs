// tests/engines/doctor.test.mjs
// what-it-is:   unit and integration tests for hooks/lib/doctor-engine.mjs and bin/ns-doctor
// what-it-does: verifies all six Q-01 section 2.5 rows (golden 0; missing thesis 1;
//               wrong-type progress 1; malformed EV 1; orphan EV-9999 1; unsourced-claim 1
//               with coherence finding naming chapter 2 and both counts); the committed-tree
//               runs (golden exit 0; unsourced-claim exit 1; config-coercion notice exit 0);
//               additionalProperties-tolerant (banked adjudication 1: extra field passes);
//               read-only proof; single-tokenizer proof; older-major exit 2;
//               --migrate exit 0 when schema is current, exit 2 when incompatible (F-HK-09);
//               style profile structure and baseline consistency (F-CI-08, voice quality
//               unchecked, deterministic half): stub-with-no-baseline is a notice, stub-with-
//               baseline is a finding, all seven sections present/in-order/agreeing/resolvable
//               produces zero findings, and each of missing-section, out-of-order,
//               baseline-field-missing, captured/sample_count disagreement, and a broken
//               Exemplars path is its own named finding
// runner:       node --test tests/engines/doctor.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

import { runChecks, checkSchemaVersion, SUPPORTED_MAJOR } from '../../hooks/lib/doctor-engine.mjs';
import { countWords } from '../../hooks/lib/stylometry-engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES = join(__dirname, 'fixtures', 'doctor');
const EXAMPLES = join(__dirname, '..', '..', 'examples');
const BIN = join(__dirname, '..', '..', 'bin', 'ns-doctor');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spawnDoctor(args) {
  return spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: process.env,
  });
}

// ---------------------------------------------------------------------------
// checkSchemaVersion unit tests
// ---------------------------------------------------------------------------

test('checkSchemaVersion: returns ok=true for supported major "2"', () => {
  const result = checkSchemaVersion({ schema_version: '2' });
  assert.equal(result.ok, true);
});

test('checkSchemaVersion: returns ok=false for older major "1"', () => {
  const result = checkSchemaVersion({ schema_version: '1' });
  assert.equal(result.ok, false);
  assert.ok(result.message.includes('migration'), 'message mentions migration');
  assert.ok(result.message.includes('"1"'), 'message names current version');
  assert.ok(result.message.includes('"' + SUPPORTED_MAJOR + '"'), 'message names supported version');
});

test('checkSchemaVersion: returns ok=false for null schema_version', () => {
  const result = checkSchemaVersion({ schema_version: null });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Q-01 section 2.5 row 1: Golden fixture - exit 0
// ---------------------------------------------------------------------------

test('golden fixture: runChecks returns zero findings', () => {
  const root = join(EXAMPLES, 'sample-book');
  const { findings } = runChecks(root);
  assert.equal(findings.length, 0,
    'golden book has no findings; got: ' + JSON.stringify(findings, null, 2));
});

test('golden fixture: CLI exits 0', () => {
  const r = spawnDoctor(['--report', '--project=' + join(EXAMPLES, 'sample-book')]);
  assert.equal(r.status, 0, 'exit code should be 0; stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  assert.ok(r.stdout.includes('pass'), 'output should include "pass"');
});

// ---------------------------------------------------------------------------
// Q-01 section 2.5 row 2: Missing structure/thesis.md - exit 1
// ---------------------------------------------------------------------------

test('missing-thesis fixture: runChecks finds missing thesis.md', () => {
  const root = join(FIXTURES, 'missing-thesis');
  const { findings } = runChecks(root);
  const structureFindings = findings.filter(f => f.type === 'structure.missing-path');
  assert.ok(structureFindings.length > 0, 'should have a structure finding');
  const thesisFinding = structureFindings.find(f => f.path.includes('thesis.md'));
  assert.ok(thesisFinding, 'finding must name structure/thesis.md');
  assert.ok(thesisFinding.message.includes('thesis.md'), 'message names the missing file');
});

test('missing-thesis fixture: CLI exits 1 and names thesis.md', () => {
  const r = spawnDoctor(['--report', '--project=' + join(FIXTURES, 'missing-thesis')]);
  assert.equal(r.status, 1, 'exit code should be 1; stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  assert.ok(r.stdout.includes('thesis.md'), 'output must name the missing file');
});

// ---------------------------------------------------------------------------
// Q-01 section 2.5 row 3: progress.json wrong field type - exit 1
// ---------------------------------------------------------------------------

test('wrong-type-progress fixture: runChecks finds type violation naming the field', () => {
  const root = join(FIXTURES, 'wrong-type-progress');
  const { findings } = runChecks(root);
  const schemaFindings = findings.filter(f => f.type === 'schema.progress-violation');
  assert.ok(schemaFindings.length > 0, 'should have schema violation finding');
  const wordCountFinding = schemaFindings.find(f => f.message.includes('word_count'));
  assert.ok(wordCountFinding, 'finding must name the word_count field');
  assert.ok(
    wordCountFinding.message.includes('integer') || wordCountFinding.message.includes('string'),
    'message should describe the type mismatch: ' + wordCountFinding.message
  );
});

test('wrong-type-progress fixture: CLI exits 1 and names the field', () => {
  const r = spawnDoctor(['--report', '--project=' + join(FIXTURES, 'wrong-type-progress')]);
  assert.equal(r.status, 1, 'exit code should be 1; stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  assert.ok(r.stdout.includes('word_count'), 'output must name the word_count field');
});

// ---------------------------------------------------------------------------
// Q-01 section 2.5 row 4: Malformed EV entry - exit 1
// ---------------------------------------------------------------------------

test('malformed-ev fixture: runChecks finds malformed entry naming EV-0001', () => {
  const root = join(FIXTURES, 'malformed-ev');
  const { findings } = runChecks(root);
  const evFindings = findings.filter(f => f.type === 'ev-grammar.malformed-entry');
  assert.ok(evFindings.length > 0, 'should have an EV grammar finding');
  assert.ok(evFindings[0].message.includes('EV-0001'), 'finding names the entry ID');
  assert.ok(evFindings[0].message.includes('claim'), 'finding names the missing claim field');
});

test('malformed-ev fixture: CLI exits 1 and names the entry ID', () => {
  const r = spawnDoctor(['--report', '--project=' + join(FIXTURES, 'malformed-ev')]);
  assert.equal(r.status, 1, 'exit code should be 1; stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  assert.ok(r.stdout.includes('EV-0001'), 'output names the malformed entry ID');
});

// ---------------------------------------------------------------------------
// Q-01 section 2.5 row 5: Orphan claim marker [claim: EV-9999] - exit 1
// ---------------------------------------------------------------------------

test('orphan-ev fixture: runChecks finds orphan EV-9999 marker', () => {
  const root = join(FIXTURES, 'orphan-ev');
  const { findings } = runChecks(root);
  const orphanFindings = findings.filter(f => f.type === 'claim-marker.orphan-ev');
  assert.ok(orphanFindings.length > 0, 'should have an orphan marker finding');
  assert.ok(orphanFindings[0].message.includes('EV-9999'), 'finding reports the orphaned claim ID');
});

test('orphan-ev fixture: CLI exits 1 and reports orphaned claim', () => {
  const r = spawnDoctor(['--report', '--project=' + join(FIXTURES, 'orphan-ev')]);
  assert.equal(r.status, 1, 'exit code should be 1; stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  assert.ok(r.stdout.includes('EV-9999'), 'output reports the orphaned claim ID');
});

// ---------------------------------------------------------------------------
// Negative-coverage gap (Phase 1 carry): malformed SRC entry - exit 1
// Mirrors the malformed-ev fixture/test above, on the source-side ledger instead.
// ---------------------------------------------------------------------------

test('malformed-src fixture: runChecks finds malformed entry naming SRC-0001', () => {
  const root = join(FIXTURES, 'malformed-src');
  const { findings } = runChecks(root);
  const srcFindings = findings.filter(f => f.type === 'src-grammar.malformed-entry');
  assert.ok(srcFindings.length > 0, 'should have a SRC grammar finding');
  assert.ok(srcFindings[0].message.includes('SRC-0001'), 'finding names the entry ID');
  // Assert the whole phrase, not just "type". A bare includes('type') also
  // matches the adjacent invalid-type branch, so it would survive a mutant
  // that disabled the missing-required-field check entirely.
  assert.ok(srcFindings[0].message.includes('missing required field "type"'),
    'finding names the missing required field, not merely the word type; got: ' + srcFindings[0].message);
});

test('malformed-src fixture: CLI exits 1 and names the entry ID', () => {
  const r = spawnDoctor(['--report', '--project=' + join(FIXTURES, 'malformed-src')]);
  assert.equal(r.status, 1, 'exit code should be 1; stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  assert.ok(r.stdout.includes('SRC-0001'), 'output names the malformed entry ID');
});

// ---------------------------------------------------------------------------
// Negative-coverage gap (Phase 1 carry): orphan SRC reference - exit 1
// Mirrors the orphan-ev fixture/test above: here an EV entry points at a SRC id
// that is absent from research/sources.md (src-ref.orphan-referenced), rather
// than a chapter marker pointing at an absent EV id.
// ---------------------------------------------------------------------------

test('orphan-src fixture: runChecks finds EV entry referencing absent SRC-9999', () => {
  const root = join(FIXTURES, 'orphan-src');
  const { findings } = runChecks(root);
  const orphanFindings = findings.filter(f => f.type === 'src-ref.orphan-referenced');
  assert.ok(orphanFindings.length > 0, 'should have an orphan SRC reference finding');
  assert.ok(orphanFindings[0].message.includes('SRC-9999'), 'finding reports the orphaned SRC ID');
});

test('orphan-src fixture: CLI exits 1 and reports orphaned SRC id', () => {
  const r = spawnDoctor(['--report', '--project=' + join(FIXTURES, 'orphan-src')]);
  assert.equal(r.status, 1, 'exit code should be 1; stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  assert.ok(r.stdout.includes('SRC-9999'), 'output reports the orphaned SRC id');
});

// ---------------------------------------------------------------------------
// Q-01 section 2.5 row 6: unsourced-claim fixture - exit 1 (word-count coherence)
// ---------------------------------------------------------------------------

test('unsourced-claim fixture: runChecks exits 1 with coherence finding naming chapter 2', () => {
  const root = join(EXAMPLES, 'fixtures', 'unsourced-claim');
  const { findings } = runChecks(root);
  const coherenceFindings = findings.filter(f => f.type === 'coherence.word-count-mismatch');
  assert.ok(coherenceFindings.length > 0, 'should have a word-count coherence finding');
  const ch2Finding = coherenceFindings.find(f => f.path.includes('02-finding-your-network'));
  assert.ok(ch2Finding, 'finding must name chapter 2 (02-finding-your-network)');
  // Both counts must appear in the message (banked adjudication 2)
  assert.ok(ch2Finding.message.includes('462'), 'message includes the recorded count (462)');
  assert.ok(ch2Finding.message.includes('481'), 'message includes the actual file count (481)');
});

test('unsourced-claim fixture: CLI exits 1 naming chapter 2 and both word counts', () => {
  const r = spawnDoctor(['--report', '--project=' + join(EXAMPLES, 'fixtures', 'unsourced-claim')]);
  assert.equal(r.status, 1, 'exit code should be 1; stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  assert.ok(r.stdout.includes('02-finding-your-network'), 'output names chapter 2');
  assert.ok(r.stdout.includes('462'), 'output includes recorded count 462');
  assert.ok(r.stdout.includes('481'), 'output includes actual count 481');
});

// ---------------------------------------------------------------------------
// Banked adjudication 1: additionalProperties-tolerant (extra field must pass)
// ---------------------------------------------------------------------------

test('extra-field-passes fixture: unknown meta.json fields do not cause findings', () => {
  const root = join(FIXTURES, 'extra-field-passes');
  const { findings } = runChecks(root);
  const metaFindings = findings.filter(f => f.type === 'shape.meta-violation');
  assert.equal(metaFindings.length, 0,
    'no meta shape violations: extra fields tolerated per S-08 Rule 2 and banked adjudication 1. ' +
    'Findings: ' + JSON.stringify(metaFindings));
});

test('extra-field-passes fixture: CLI exits 0 with extra unknown meta.json fields', () => {
  const r = spawnDoctor(['--report', '--project=' + join(FIXTURES, 'extra-field-passes')]);
  assert.equal(r.status, 0,
    'exit 0: extra unknown fields must not cause failure per S-08 Rule 2. ' +
    'stdout: ' + r.stdout + ' stderr: ' + r.stderr);
});

// ---------------------------------------------------------------------------
// Older-major exit 2 (migration required)
// ---------------------------------------------------------------------------

test('older-major fixture: checkSchemaVersion returns ok=false naming both versions', () => {
  const result = checkSchemaVersion({ schema_version: '1' });
  assert.equal(result.ok, false);
  assert.ok(result.message.includes('"1"'), 'message names the current schema version');
  assert.ok(result.message.includes('"' + SUPPORTED_MAJOR + '"'), 'message names the supported version');
});

test('older-major fixture: CLI exits 2 with migration-required message', () => {
  const r = spawnDoctor(['--report', '--project=' + join(FIXTURES, 'older-major')]);
  assert.equal(r.status, 2,
    'exit code should be 2 (migration required); stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  const combined = r.stdout + r.stderr;
  assert.ok(
    combined.includes('migration') || combined.includes('migrate'),
    'output mentions migration'
  );
});

// ---------------------------------------------------------------------------
// Config coercion: exit 0 with D-03 notice (coercion is a report not a failure)
// ---------------------------------------------------------------------------

test('config-coercion fixture: runChecks returns a notice for thesis_alignment block, zero findings', () => {
  const root = join(FIXTURES, 'config-coercion');
  const { findings, notices } = runChecks(root);
  // Coercion is a NOTICE, not a finding; exit code must be 0
  const coercedFindings = findings.filter(f => f.type === 'config-coercion.thesis-alignment');
  assert.equal(coercedFindings.length, 0, 'coercion must NOT add a finding (it is a notice; exit 0)');
  const coercedNotices = notices.filter(n => n.type === 'config-coercion.thesis-alignment');
  assert.ok(coercedNotices.length > 0, 'coercion must produce a notice');
  assert.ok(coercedNotices[0].message.includes('D-03'), 'notice references D-03');
  assert.ok(
    coercedNotices[0].message.includes('thesis_alignment') || coercedNotices[0].path.includes('thesis_alignment'),
    'notice identifies thesis_alignment'
  );
});

test('config-coercion fixture: CLI exits 0 and prints coercion notice', () => {
  const r = spawnDoctor(['--report', '--project=' + join(FIXTURES, 'config-coercion')]);
  assert.equal(r.status, 0,
    'exit 0: coercion is a report not a failure per TSK-028 brief and Q-01 2.5. ' +
    'stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  assert.ok(
    r.stdout.includes('D-03') || r.stdout.includes('coercion') || r.stdout.includes('NOTICE'),
    'output includes coercion notice: ' + r.stdout
  );
});

// Q-01 2.5 cross-check documentation: coercion exits 0, no contradiction with Q-01 table.
// Q-01 section 2.5 has six rows, none is config-coercion. S-08 section 13 acceptance signal 6
// says ns-gate (not ns-doctor) is the coercer at gate time. The doctor reports informally.
// This confirms: coercion -> exit 0 is the correct reading; no contradiction found.
test('config-coercion: exit 0 reading confirmed; no contradiction with Q-01 section 2.5', () => {
  const root = join(FIXTURES, 'config-coercion');
  const { findings } = runChecks(root);
  assert.ok(
    !findings.some(f => f.type === 'config-coercion.thesis-alignment'),
    'config coercion must be a notice, not a finding (so exit code stays 0)'
  );
});

// ---------------------------------------------------------------------------
// --migrate mode: exits 2
// ---------------------------------------------------------------------------

test('--migrate on current version: CLI exits 0 with nothing-to-migrate message (F-HK-09)', () => {
  const r = spawnDoctor(['--migrate', '--project=' + join(EXAMPLES, 'sample-book')]);
  assert.equal(r.status, 0,
    'exit 0: --migrate on an already-current schema is success, not an error, and must not ' +
    'be indistinguishable from a broken bible; stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  const combined = r.stdout + r.stderr;
  assert.ok(
    combined.includes('nothing to migrate') && combined.includes('schema is current'),
    'output states "nothing to migrate" and "schema is current": ' + combined
  );
});

test('--migrate on current version, --json: status field reflects success, not the old no-migrations error shape', () => {
  const r = spawnDoctor(['--migrate', '--json', '--project=' + join(EXAMPLES, 'sample-book')]);
  assert.equal(r.status, 0, 'exit 0 with --json too; stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'current', 'JSON status field must be "current"; got: ' + json.status);
  assert.ok(
    json.message.includes('nothing to migrate') && json.message.includes('schema is current'),
    'JSON message states nothing to migrate, schema is current: ' + json.message
  );
});

test('--migrate on older version: CLI exits 2 with migration-required message', () => {
  const r = spawnDoctor(['--migrate', '--project=' + join(FIXTURES, 'older-major')]);
  assert.equal(r.status, 2, 'exit 2: older schema version exits 2 with migration message');
  const combined = r.stdout + r.stderr;
  assert.ok(
    combined.includes('migration') || combined.includes('migrate'),
    'output mentions migration: ' + combined
  );
});

// ---------------------------------------------------------------------------
// --validate-packs: exits 0 with no packs directory
// ---------------------------------------------------------------------------

test('--validate-packs: CLI exits 0 when no packs directory', () => {
  const r = spawnDoctor(['--validate-packs', '--project=' + join(EXAMPLES, 'sample-book')]);
  assert.equal(r.status, 0, 'exit 0: no packs directory is clean per brief. stderr: ' + r.stderr);
  assert.ok(r.stdout.includes('packs'), 'output mentions packs: ' + r.stdout);
});

// ---------------------------------------------------------------------------
// Banked adjudication 2: single-tokenizer proof
// ---------------------------------------------------------------------------

test('word-count: countWords from stylometry-engine gives 481 for unsourced-claim ch2', () => {
  // Proves the doctor uses the stylometry engine's tokenizer (banked adjudication 2).
  // countWords is imported directly from stylometry-engine.mjs - not reimplemented.
  const ch2Path = join(
    EXAMPLES, 'fixtures', 'unsourced-claim', 'chapters', '02-finding-your-network.md'
  );
  const text = readFileSync(ch2Path, 'utf8');
  const count = countWords(text);
  assert.equal(count, 481,
    'stylometry tokenizer gives 481 for unsourced-claim ch2; got ' + count);
});

test('word-count: countWords gives 527 for golden sample-book ch2', () => {
  const ch2Path = join(EXAMPLES, 'sample-book', 'chapters', '02-finding-your-network.md');
  const text = readFileSync(ch2Path, 'utf8');
  const count = countWords(text);
  assert.equal(count, 527,
    'stylometry tokenizer gives 527 for golden ch2 (matches progress.json); got ' + count);
});

test('word-count: countWords gives 528 for golden sample-book ch1', () => {
  const ch1Path = join(EXAMPLES, 'sample-book', 'chapters', '01-listening-before-speaking.md');
  const text = readFileSync(ch1Path, 'utf8');
  const count = countWords(text);
  assert.equal(count, 528,
    'stylometry tokenizer gives 528 for golden ch1 (matches updated progress.json); got ' + count);
});

// ---------------------------------------------------------------------------
// Read-only covenant proof
// ---------------------------------------------------------------------------

test('doctor-engine.mjs contains no write calls (read-only covenant)', () => {
  const enginePath = join(__dirname, '..', '..', 'hooks', 'lib', 'doctor-engine.mjs');
  const source = readFileSync(enginePath, 'utf8');
  // Check for actual function CALL syntax (with opening parenthesis) to distinguish
  // code calls from documentation references in comments.
  const writePatterns = ['writeFileSync(', 'writeFile(', 'renameSync(', 'mkdirSync(', 'appendFileSync('];
  for (const pat of writePatterns) {
    assert.equal(
      source.includes(pat), false,
      'doctor-engine.mjs must not contain "' + pat + '" (read-only covenant)'
    );
  }
});

// ---------------------------------------------------------------------------
// Style profile structure and baseline consistency (F-CI-08, voice quality
// unchecked, deterministic half): docs/formats/style-profile.md's seven-
// section grammar, the pre-capture stub rule, and the two promised behaviors
// (config.json agreement on the Baseline reference block, Exemplars path
// resolution). Uses a temp clone of the golden fixture, mutated per scenario,
// driving runChecks directly (the doctor engine exists "so tests can drive
// the engine directly without CLI overhead" per bin/ns-doctor's own header).
// ---------------------------------------------------------------------------

const STUB_STYLE_PROFILE = [
  '<!-- context/style-profile.md',
  '     Written by capture-voice at intake. Do not edit this file directly.',
  '     Run /capture-voice to build or refresh the style profile.',
  '     Format reference: docs/formats/style-profile.md',
  '-->',
  ''
].join('\n');

function makeTempSampleBookClone() {
  const tempDir = mkdtempSync(join(tmpdir(), 'ns-doctor-style-profile-'));
  cpSync(join(EXAMPLES, 'sample-book'), tempDir, { recursive: true });
  return tempDir;
}

function readBookConfig(dir) {
  return JSON.parse(readFileSync(join(dir, '.studio', 'config.json'), 'utf8'));
}

function writeBookConfig(dir, config) {
  writeFileSync(join(dir, '.studio', 'config.json'), JSON.stringify(config, null, 2), 'utf8');
}

function writeBookStyleProfile(dir, content) {
  writeFileSync(join(dir, 'context', 'style-profile.md'), content, 'utf8');
}

function removeTempClone(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// Builds a fully valid, all-seven-sections-in-order profile whose Baseline
// reference agrees with the given config baseline. Values are read from the
// clone's own config.json (never hardcoded), so a future re-capture of
// sample-book cannot make these tests stale.
function buildValidStyleProfile(baseline) {
  return [
    '# Style profile',
    '',
    '## Voice',
    '- tone: plainspoken.',
    '- point-of-view: second person.',
    '- tense: present.',
    '- register: trade non-fiction.',
    '',
    '## Diction',
    '- prefer: concrete words.',
    '- avoid: jargon.',
    '',
    '## Rhythm',
    '- sentence length: short.',
    '- paragraph length: short.',
    '',
    '## Do',
    '- be direct.',
    '',
    '## Do not',
    '- ramble.',
    '',
    '## Exemplars',
    '- context/samples/voice-sample-01.md',
    '',
    '## Baseline reference',
    '- vector: .studio/config.json -> stylometry.baseline.markers',
    '- captured: ' + baseline.captured,
    '- sample_count: ' + baseline.sample_count,
    ''
  ].join('\n');
}

function findHeadingRange(lines, heading) {
  const startIdx = lines.findIndex(l => l.trim() === heading);
  if (startIdx === -1) throw new Error('heading not found in test fixture content: ' + heading);
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('## ')) { endIdx = i; break; }
  }
  return [startIdx, endIdx];
}

function removeSectionFromProfile(content, heading) {
  const lines = content.split('\n');
  const [startIdx, endIdx] = findHeadingRange(lines, heading);
  lines.splice(startIdx, endIdx - startIdx);
  return lines.join('\n');
}

// Swaps two section blocks (heading line through body). headingA must appear
// before headingB in the source content.
function swapProfileSections(content, headingA, headingB) {
  const lines = content.split('\n');
  const [aStart, aEnd] = findHeadingRange(lines, headingA);
  const [bStart, bEnd] = findHeadingRange(lines, headingB);
  if (aStart > bStart) throw new Error('expected ' + headingA + ' before ' + headingB + ' in test fixture content');
  const blockA = lines.slice(aStart, aEnd);
  const blockB = lines.slice(bStart, bEnd);
  const before = lines.slice(0, aStart);
  const between = lines.slice(aEnd, bStart);
  const after = lines.slice(bEnd);
  return [...before, ...blockB, ...between, ...blockA, ...after].join('\n');
}

function setBaselineField(content, field, value) {
  const re = new RegExp('^(-\\s*' + field + ':\\s*).*$', 'm');
  return content.replace(re, '$1' + value);
}

function removeBaselineField(content, field) {
  const lines = content.split('\n');
  const idx = lines.findIndex(l => new RegExp('^-\\s*' + field + ':').test(l.trim()));
  if (idx === -1) throw new Error('field not found in test fixture content: ' + field);
  lines.splice(idx, 1);
  return lines.join('\n');
}

function setExemplarPath(content, newPath) {
  return content.replace(/^-\s*context\/samples\/voice-sample-01\.md\s*$/m, '- ' + newPath);
}

test('style profile: stub with no config baseline is a notice, not a finding; CLI exit stays 0', () => {
  const dir = makeTempSampleBookClone();
  try {
    writeBookStyleProfile(dir, STUB_STYLE_PROFILE);
    const config = readBookConfig(dir);
    config.stylometry.baseline = null;
    writeBookConfig(dir, config);

    const { findings, notices } = runChecks(dir);
    const styleFindings = findings.filter(f => f.type.startsWith('style-profile.'));
    assert.equal(styleFindings.length, 0,
      'stub with no config baseline must not produce a finding; got: ' + JSON.stringify(styleFindings));
    const notCaptured = notices.filter(n => n.type === 'style-profile.not-captured');
    assert.equal(notCaptured.length, 1, 'expected exactly one style-profile.not-captured notice');
    assert.equal(notCaptured[0].message, 'style profile not yet captured; run capture-voice');

    const r = spawnDoctor(['--report', '--project=' + dir]);
    assert.equal(r.status, 0,
      'exit stays 0 on an otherwise-clean pre-capture book; stdout: ' + r.stdout + ' stderr: ' + r.stderr);
  } finally {
    removeTempClone(dir);
  }
});

test('style profile: stub with a config baseline already present is a finding (inconsistent state)', () => {
  const dir = makeTempSampleBookClone();
  try {
    writeBookStyleProfile(dir, STUB_STYLE_PROFILE);
    // config.json is left as the golden fixture's own: it already carries a real
    // stylometry baseline, so a stub profile alongside it is inconsistent state.

    const { findings } = runChecks(dir);
    const stubFindings = findings.filter(f => f.type === 'style-profile.stub-with-baseline');
    assert.equal(stubFindings.length, 1,
      'stub alongside a config baseline must be a finding; got: ' + JSON.stringify(findings));

    const r = spawnDoctor(['--report', '--project=' + dir]);
    assert.equal(r.status, 1, 'exit should be 1: baseline without a captured profile is inconsistent state');
  } finally {
    removeTempClone(dir);
  }
});

test('style profile: all seven sections in order, agreeing config, resolvable exemplar => no findings', () => {
  const dir = makeTempSampleBookClone();
  try {
    const config = readBookConfig(dir);
    writeBookStyleProfile(dir, buildValidStyleProfile(config.stylometry.baseline));

    const { findings } = runChecks(dir);
    const styleFindings = findings.filter(f => f.type.startsWith('style-profile.'));
    assert.equal(styleFindings.length, 0,
      'valid profile must produce no style-profile findings; got: ' + JSON.stringify(styleFindings));
  } finally {
    removeTempClone(dir);
  }
});

// Three representative missing-section cases: the first section, a
// negative-directive section whose heading is a substring of another
// ("## Do" vs "## Do not"), and the last section (which also carries fields).
for (const heading of ['## Voice', '## Do not', '## Baseline reference']) {
  test('style profile: missing section "' + heading + '" is a finding', () => {
    const dir = makeTempSampleBookClone();
    try {
      const config = readBookConfig(dir);
      const content = removeSectionFromProfile(buildValidStyleProfile(config.stylometry.baseline), heading);
      writeBookStyleProfile(dir, content);

      const { findings } = runChecks(dir);
      const missing = findings.filter(
        f => f.type === 'style-profile.missing-section' && f.message.includes('"' + heading + '"')
      );
      assert.equal(missing.length, 1,
        'expected a missing-section finding naming ' + heading + '; got: ' + JSON.stringify(findings));
    } finally {
      removeTempClone(dir);
    }
  });
}

test('style profile: sections present but out of order is a finding', () => {
  const dir = makeTempSampleBookClone();
  try {
    const config = readBookConfig(dir);
    const content = swapProfileSections(
      buildValidStyleProfile(config.stylometry.baseline), '## Voice', '## Diction'
    );
    writeBookStyleProfile(dir, content);

    const { findings } = runChecks(dir);
    const orderFindings = findings.filter(f => f.type === 'style-profile.section-order');
    assert.equal(orderFindings.length, 1,
      'expected a section-order finding; got: ' + JSON.stringify(findings));
    const missingFindings = findings.filter(f => f.type === 'style-profile.missing-section');
    assert.equal(missingFindings.length, 0, 'reordering must not also report a missing section');
  } finally {
    removeTempClone(dir);
  }
});

test('style profile: Baseline reference missing the "captured" field is a finding', () => {
  const dir = makeTempSampleBookClone();
  try {
    const config = readBookConfig(dir);
    const content = removeBaselineField(buildValidStyleProfile(config.stylometry.baseline), 'captured');
    writeBookStyleProfile(dir, content);

    const { findings } = runChecks(dir);
    const fieldFindings = findings.filter(
      f => f.type === 'style-profile.baseline-field-missing' && f.message.includes('"captured"')
    );
    assert.equal(fieldFindings.length, 1,
      'expected a baseline-field-missing finding for captured; got: ' + JSON.stringify(findings));
  } finally {
    removeTempClone(dir);
  }
});

test('style profile: captured disagreeing with config.json is a finding', () => {
  const dir = makeTempSampleBookClone();
  try {
    const config = readBookConfig(dir);
    const content = setBaselineField(
      buildValidStyleProfile(config.stylometry.baseline), 'captured', '2099-01-01T00:00:00Z'
    );
    writeBookStyleProfile(dir, content);

    const { findings } = runChecks(dir);
    const disagreeFindings = findings.filter(f => f.type === 'style-profile.captured-disagreement');
    assert.equal(disagreeFindings.length, 1,
      'expected a captured-disagreement finding; got: ' + JSON.stringify(findings));
    assert.ok(disagreeFindings[0].message.includes('2099-01-01T00:00:00Z'));
    assert.ok(disagreeFindings[0].message.includes(config.stylometry.baseline.captured));
  } finally {
    removeTempClone(dir);
  }
});

test('style profile: sample_count disagreeing with config.json is a finding', () => {
  const dir = makeTempSampleBookClone();
  try {
    const config = readBookConfig(dir);
    const wrongCount = config.stylometry.baseline.sample_count + 997;
    const content = setBaselineField(
      buildValidStyleProfile(config.stylometry.baseline), 'sample_count', String(wrongCount)
    );
    writeBookStyleProfile(dir, content);

    const { findings } = runChecks(dir);
    const disagreeFindings = findings.filter(f => f.type === 'style-profile.sample-count-disagreement');
    assert.equal(disagreeFindings.length, 1,
      'expected a sample-count-disagreement finding; got: ' + JSON.stringify(findings));
    assert.ok(disagreeFindings[0].message.includes(String(wrongCount)));
  } finally {
    removeTempClone(dir);
  }
});

test('style profile: broken Exemplars path is a finding', () => {
  const dir = makeTempSampleBookClone();
  try {
    const config = readBookConfig(dir);
    const content = setExemplarPath(
      buildValidStyleProfile(config.stylometry.baseline), 'context/samples/does-not-exist.md'
    );
    writeBookStyleProfile(dir, content);

    const { findings } = runChecks(dir);
    const brokenFindings = findings.filter(f => f.type === 'style-profile.broken-exemplar-path');
    assert.equal(brokenFindings.length, 1,
      'expected a broken-exemplar-path finding; got: ' + JSON.stringify(findings));
    assert.ok(brokenFindings[0].message.includes('does-not-exist.md'));
  } finally {
    removeTempClone(dir);
  }
});
