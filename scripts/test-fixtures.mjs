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
import { mkdtempSync, cpSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
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
const NS_NOTES = join(BIN, 'ns-notes');

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
      // ns-notes exits 1, unlike every other row above: EV-0001 and EV-0005 both cite
      // SRC-0003 with a blank locator, which is real, pre-existing data in the committed
      // ledger (not a planted defect), so it correctly lands in production/apparatus-
      // attention.md rather than a malformed note. This row proves ns-notes runs end to
      // end against the real committed ledger via the shared temp-clone harness and that
      // the run leaves no residue; tests/engines/notes-cli.test.mjs is the more detailed,
      // dedicated proof of exit-code mapping and byte-identical regeneration.
      { engine: NS_NOTES, args: [], expected: 1 },
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

// ---------------------------------------------------------------------------
// Snapshot examples/ CONTENT before the matrix runs, so the post-run assertion
// can tell residue produced by this run apart from uncommitted work that was
// already there (see the residue diff below).
//
// This hashes file content rather than diffing `git status --porcelain` lines.
// A porcelain line is not sensitive to how much a file changed: a file that is
// already modified before the run emits the same " M path" line whether or not
// an engine appends to it during the run, so a line-level diff silently
// classifies real residue as pre-existing work. Hashing also catches files an
// engine deletes or reverts, which a line diff over the after-snapshot misses
// entirely. Content hashing needs no git, so the check keeps working in a
// tarball export or a non-repo checkout.
// ---------------------------------------------------------------------------

const EXAMPLES_DIR = join(REPO_ROOT, 'examples');

function snapshotExamples() {
  const map = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = relative(REPO_ROOT, abs).split('\\').join('/');
      map.set(rel, createHash('sha256').update(readFileSync(abs)).digest('hex'));
    }
  };
  walk(EXAMPLES_DIR);
  return map;
}

const beforeContent = snapshotExamples();

// Best-effort, informational only: which examples/ paths were ALREADY dirty
// before this run. Never fails the assertion; it exists so a reader is not
// misled into reading "no residue" as "tree is clean". git being unavailable
// costs only this note, not the residue check itself.
let baselineDirt = null;
try {
  baselineDirt = execFileSync('git', ['status', '--porcelain', '--', 'examples/'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
} catch {
  baselineDirt = null;
}

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
// Residue assertion
// Verifies the matrix runs left no residue in the committed fixture
// directories, without requiring examples/ to have been clean to begin with.
// Gate and doctor runs that write reports must use temp clones; this is the
// proof.
//
// Residue is decided by comparing a CONTENT-HASH snapshot of examples/ taken
// before the matrix against one taken after. Any path that is added, removed,
// or whose bytes changed is residue and fails the assertion. Uncommitted work
// that predates the run is invisible to this comparison, because its bytes do
// not move, so the check no longer has to demand a clean tree to be runnable.
// ---------------------------------------------------------------------------

process.stdout.write('\n[test-fixtures] asserting the matrix wrote nothing into examples/\n');

{
  const afterContent = snapshotExamples();
  const residue = [];

  for (const [path, hash] of afterContent) {
    const before = beforeContent.get(path);
    if (before === undefined) {
      residue.push('created: ' + path);
    } else if (before !== hash) {
      residue.push('modified: ' + path);
    }
  }
  for (const path of beforeContent.keys()) {
    if (!afterContent.has(path)) {
      residue.push('deleted: ' + path);
    }
  }

  if (residue.length > 0) {
    const detail = residue.sort().join('\n');
    failures.push('the matrix wrote into examples/ -- temp-clone discipline violated:\n' + detail);
    process.stderr.write('[test-fixtures] ERROR: the matrix wrote into examples/:\n' + detail + '\n');
  } else if (baselineDirt) {
    const paths = baselineDirt.split('\n').length;
    process.stdout.write(
      '[test-fixtures] the matrix wrote nothing into examples/: temp-clone discipline confirmed\n' +
      '[test-fixtures] NOTE: examples/ was ALREADY dirty before this run (' + paths +
      ' uncommitted path(s)), so this result does not mean the tree is clean:\n' + baselineDirt + '\n'
    );
  } else {
    process.stdout.write('[test-fixtures] examples/ tree is clean: temp-clone discipline confirmed\n');
  }
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
