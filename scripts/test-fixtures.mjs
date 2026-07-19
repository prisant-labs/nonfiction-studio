// scripts/test-fixtures.mjs
// what-it-is:   bidirectional fixture matrix runner
// what-it-does: runs the golden fixture and the four planted-bad fixtures through the
//               five engine CLIs (ns-claims, ns-stylometry, ns-scrub, ns-doctor, ns-gate)
//               using TEMP CLONES ONLY so committed fixture files are never modified; asserts
//               each engine exits at the code declared in Q-01 section 1.2 (corrected tables,
//               dated 2026-07-18); asserts the committed tree is clean after all runs complete.
// why:          Q-02 1.2 fixture-tests step; bidirectionality confirms checkers fire on
//               known-bad input and pass on known-good; temp-clone discipline is the
//               queued residue-hygiene decision codified as a gate.
// exit taxonomy: 0 = all assertions pass; 1 = assertion failure(s); 2 = operational error

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Engine paths
// ---------------------------------------------------------------------------

const BIN = join(REPO_ROOT, 'bin');
const NS_CLAIMS = join(BIN, 'ns-claims');
const NS_STYLOMETRY = join(BIN, 'ns-stylometry');
const NS_SCRUB = join(BIN, 'ns-scrub');
const NS_DOCTOR = join(BIN, 'ns-doctor');
const NS_GATE = join(BIN, 'ns-gate');

// ---------------------------------------------------------------------------
// Fixture source directories (committed; never modified)
// ---------------------------------------------------------------------------

const EXAMPLES = join(REPO_ROOT, 'examples');
const FIXTURES_DIR = join(EXAMPLES, 'fixtures');
const GOLDEN = join(EXAMPLES, 'sample-book');

// ---------------------------------------------------------------------------
// Bidirectional matrix (Q-01 section 1.2, corrected 2026-07-18/2026-07-19)
//
// Row schema:
//   fixture: path to the committed fixture directory
//   label:   short name for reporting
//   rows:    array of { engine, args, expected }
//              engine: path to the CLI binary
//              args:   extra CLI arguments (--project is added automatically)
//              expected: expected exit code
// ---------------------------------------------------------------------------

const MATRIX = [
  {
    fixture: GOLDEN,
    label: 'golden (sample-book)',
    rows: [
      { engine: NS_CLAIMS, args: [], expected: 0 },
      { engine: NS_STYLOMETRY, args: [], expected: 0 },
      { engine: NS_SCRUB, args: [], expected: 0 },
      { engine: NS_DOCTOR, args: ['--check'], expected: 0 },
      { engine: NS_GATE, args: [], expected: 0 },
    ],
  },
  {
    fixture: join(FIXTURES_DIR, 'unsourced-claim'),
    label: 'unsourced-claim',
    rows: [
      // ns-doctor exits 1: word-count coherence check catches the extra sentence
      // [corrected 2026-07-18: ns-claims exits 0 because unmarked sentence is invisible to marker resolution]
      { engine: NS_DOCTOR, args: ['--check'], expected: 1 },
      { engine: NS_CLAIMS, args: [], expected: 0 },
      { engine: NS_STYLOMETRY, args: [], expected: 0 },
      { engine: NS_SCRUB, args: [], expected: 0 },
    ],
  },
  {
    fixture: join(FIXTURES_DIR, 'continuity-error'),
    label: 'continuity-error',
    rows: [
      // ns-scrub exits 1: continuity.name-mismatch for method name casing between chapters
      { engine: NS_SCRUB, args: ['--mode=continuity'], expected: 1 },
      { engine: NS_DOCTOR, args: ['--check'], expected: 0 },
      { engine: NS_CLAIMS, args: [], expected: 0 },
      { engine: NS_STYLOMETRY, args: [], expected: 0 },
    ],
  },
  {
    fixture: join(FIXTURES_DIR, 'voice-drift'),
    label: 'voice-drift',
    rows: [
      // ns-stylometry exits 1: drift score at or above threshold (threshold=20 in fixture config)
      // [corrected 2026-07-18 per TSK-026 reconciliation: first_person_rate is the flagged marker]
      { engine: NS_STYLOMETRY, args: [], expected: 1 },
      { engine: NS_DOCTOR, args: ['--check'], expected: 0 },
      { engine: NS_CLAIMS, args: [], expected: 0 },
      { engine: NS_SCRUB, args: [], expected: 0 },
    ],
  },
  {
    fixture: join(FIXTURES_DIR, 'ai-injection'),
    label: 'ai-injection',
    rows: [
      // ns-scrub exits 1: injection.pattern-match inside the planted block quote
      // [corrected 2026-07-18: scrub engine emits injection.pattern-match type string]
      { engine: NS_SCRUB, args: ['--mode=injection'], expected: 1 },
      { engine: NS_DOCTOR, args: ['--check'], expected: 0 },
      { engine: NS_CLAIMS, args: [], expected: 0 },
      { engine: NS_STYLOMETRY, args: [], expected: 0 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Temp clone helper
// ---------------------------------------------------------------------------

function makeTempClone(sourceDir, label) {
  const prefix = 'nonfiction-fixture-' + label.replace(/[^a-z0-9]/gi, '-') + '-';
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  cpSync(sourceDir, tempDir, { recursive: true });
  return tempDir;
}

function removeTempClone(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Non-fatal: temp cleanup best-effort
  }
}

// ---------------------------------------------------------------------------
// Run one engine against a temp clone
// ---------------------------------------------------------------------------

function runEngine(engine, extraArgs, projectDir) {
  const result = spawnSync('node', [engine, '--project=' + projectDir, ...extraArgs], {
    encoding: 'utf8',
    env: process.env,
    cwd: REPO_ROOT,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

// ---------------------------------------------------------------------------
// Main: run the matrix
// ---------------------------------------------------------------------------

const failures = [];
const tempDirs = [];

process.stdout.write('[test-fixtures] running bidirectional matrix (' + MATRIX.length + ' fixtures)\n');

for (const fixture of MATRIX) {
  if (!existsSync(fixture.fixture)) {
    process.stderr.write('[test-fixtures] FATAL: fixture not found: ' + fixture.fixture + '\n');
    process.exit(2);
  }

  // Create a temp clone for this fixture
  let tempDir;
  try {
    tempDir = makeTempClone(fixture.fixture, fixture.label);
    tempDirs.push(tempDir);
  } catch (err) {
    process.stderr.write('[test-fixtures] FATAL: cannot create temp clone for ' + fixture.label + ': ' + err.message + '\n');
    process.exit(2);
  }

  process.stdout.write('\n  fixture: ' + fixture.label + ' (clone: ' + tempDir + ')\n');

  for (const row of fixture.rows) {
    const engineName = row.engine.replace(REPO_ROOT + '\\', '').replace(REPO_ROOT + '/', '').replace(/\\/g, '/');
    const result = runEngine(row.engine, row.args, tempDir);

    if (result.error) {
      failures.push(fixture.label + ' / ' + engineName + ': spawn error: ' + result.error.message);
      process.stdout.write('    [FAIL] ' + engineName + ': spawn error\n');
      continue;
    }

    const actual = result.status;
    const expected = row.expected;
    const verdict = actual === expected ? 'pass' : 'FAIL';

    process.stdout.write(
      '    [' + verdict + '] ' + engineName + ': expected exit ' + expected +
      ', got ' + actual + '\n'
    );

    if (actual !== expected) {
      const detail = [
        'fixture: ' + fixture.label,
        'engine: ' + engineName,
        'args: ' + (row.args.length ? row.args.join(' ') : '(none)'),
        'expected exit: ' + expected,
        'actual exit: ' + actual,
      ];
      if (result.stdout.trim()) detail.push('stdout: ' + result.stdout.trim().split('\n')[0]);
      if (result.stderr.trim()) detail.push('stderr: ' + result.stderr.trim().split('\n')[0]);
      failures.push(detail.join(' | '));
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup temp clones
// ---------------------------------------------------------------------------

for (const td of tempDirs) {
  removeTempClone(td);
}

// ---------------------------------------------------------------------------
// Committed-tree clean assertion
// Verifies the matrix runs left no residue in the committed fixture directories.
// Gate and doctor runs that write reports must use temp clones; this is the proof.
// ---------------------------------------------------------------------------

process.stdout.write('\n[test-fixtures] asserting committed tree is clean after fixture runs\n');

// Scope the clean-tree check to the examples/ directory, which contains the committed
// fixture files. This proves that engine runs (which write gate reports, progress updates,
// etc.) did not modify any committed fixture file in place. Scoping to examples/ avoids
// false failures from uncommitted files elsewhere (e.g., new scripts added by this task).
let gitStatus;
try {
  gitStatus = execFileSync('git', ['status', '--porcelain', '--', 'examples/'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
} catch (err) {
  process.stderr.write('[test-fixtures] WARN: git status check failed: ' + err.message + '\n');
  gitStatus = null;
}

if (gitStatus === null) {
  process.stdout.write('[test-fixtures] (tree-clean assertion skipped: not a git repo or git unavailable)\n');
} else if (gitStatus === '') {
  process.stdout.write('[test-fixtures] examples/ tree is clean: temp-clone discipline confirmed\n');
} else {
  failures.push('examples/ tree is dirty after fixture runs -- temp-clone discipline violated:\n' + gitStatus);
  process.stderr.write('[test-fixtures] ERROR: examples/ tree is dirty after fixture runs:\n' + gitStatus + '\n');
}

// ---------------------------------------------------------------------------
// Final report
// ---------------------------------------------------------------------------

process.stdout.write('\n');
if (failures.length === 0) {
  process.stdout.write('[test-fixtures] pass: all fixture matrix assertions passed\n');
  process.exit(0);
} else {
  process.stderr.write('[test-fixtures] ' + failures.length + ' assertion failure(s):\n');
  for (const f of failures) {
    process.stderr.write('  - ' + f + '\n');
  }
  process.exit(1);
}
