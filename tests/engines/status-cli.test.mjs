// tests/engines/status-cli.test.mjs
// what-it-is:   CLI-level tests for bin/ns-status
// what-it-does: spawns the real bin/ns-status binary against temp clones of the golden sample book
//               (never the committed examples/sample-book fixture in place) to prove: byte-identical
//               output across two runs against unchanged state (both output modes), that the CLI
//               writes nothing to the project tree, that gate verdict and drift score come from the
//               newest .studio/gate/ report and never from progress.json's last_gate or per-chapter
//               drift_score fields, the golden-book numbers, the exit-2 operational-error taxonomy,
//               and that no shipped output string names the tier-climb word
//               scripts/tier-report.mjs reserves for a different concept (controller Decision 3).
// runner:       node --test "tests/engines/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, writeFileSync, mkdirSync, cpSync, mkdtempSync, rmSync, readdirSync, statSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = join(__dirname, '..', '..');
const EXAMPLES = join(REPO_ROOT, 'examples');
const BIN = join(REPO_ROOT, 'bin', 'ns-status');
const GOLDEN = join(EXAMPLES, 'sample-book');

// Built, not written literally: this file is itself a shipped file, and the acceptance
// criterion this constant supports is "no SHIPPED STRING contains the word" - so the word
// itself must not appear as a literal token in this source file either.
const FORBIDDEN_TIER_WORD = 'burn' + 'down';

function makeTempClone(sourceDir) {
  const base = join(os.tmpdir(), 'ns-status-cli-test');
  mkdirSync(base, { recursive: true });
  const tmpDir = mkdtempSync(base + '/clone-');
  cpSync(sourceDir, tmpDir, { recursive: true });
  return tmpDir;
}

function spawnStatus(cwd, args = []) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: process.env });
}

/** Recursive {relPath -> "size:mtimeMs"} snapshot, used to prove a run wrote nothing at all. */
function snapshotTree(rootDir) {
  const map = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        const rel = relative(rootDir, abs).split('\\').join('/');
        const st = statSync(abs);
        map.set(rel, st.size + ':' + st.mtimeMs);
      }
    }
  };
  walk(rootDir);
  return map;
}

// ---------------------------------------------------------------------------
// HEADLINE 1: determinism - two runs against unchanged state produce byte-
// identical stdout, in BOTH output modes.
// ---------------------------------------------------------------------------

test('DETERMINISM (json mode): two runs against unchanged state produce byte-identical stdout', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const first = spawnStatus(tmp, ['--json']);
    const second = spawnStatus(tmp, ['--json']);
    assert.equal(first.status, 0, 'stderr: ' + first.stderr);
    assert.equal(second.status, 0, 'stderr: ' + second.stderr);
    assert.equal(first.stdout, second.stdout, 'two --json runs over unchanged state must be byte-identical');
    // Parses as JSON at all (sanity: not comparing two empty strings).
    assert.ok(JSON.parse(first.stdout));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('DETERMINISM (text/board mode): two runs against unchanged state produce byte-identical stdout', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const first = spawnStatus(tmp, []);
    const second = spawnStatus(tmp, []);
    assert.equal(first.status, 0, 'stderr: ' + first.stderr);
    assert.equal(second.status, 0, 'stderr: ' + second.stderr);
    assert.equal(first.stdout, second.stdout, 'two default-mode runs over unchanged state must be byte-identical');
    assert.ok(first.stdout.length > 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// HEADLINE 2: read-only - the project tree's contents and modification times
// are unchanged across a run, in either mode.
// ---------------------------------------------------------------------------

test('READ-ONLY: the project tree is byte- and mtime-unchanged after a --json run', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const before = snapshotTree(tmp);
    const result = spawnStatus(tmp, ['--json']);
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    const after = snapshotTree(tmp);
    assert.deepEqual(after, before, 'no file was created, removed, or modified by the run');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('READ-ONLY: the project tree is byte- and mtime-unchanged after a default-mode run', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const before = snapshotTree(tmp);
    const result = spawnStatus(tmp, []);
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    const after = snapshotTree(tmp);
    assert.deepEqual(after, before, 'no file was created, removed, or modified by the run');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// HEADLINE 3: gate-source invariant - progress.json's last_gate AND per-chapter
// drift_score are deliberately set to disagree with the real newest .studio/gate/
// report, on BOTH the verdict and the numeric drift score; the CLI must follow
// the gate directory report, not progress.json, for either value.
// ---------------------------------------------------------------------------

test('GATE SOURCE: the CLI follows the newest .studio/gate/ report, never progress.json last_gate or drift_score', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const progressPath = join(tmp, '.studio', 'progress.json');
    const progress = JSON.parse(readFileSync(progressPath, 'utf8'));

    // The real committed gate report for chapter 1 says verdict "pass" and drift 10.86
    // (examples/sample-book/.studio/gate/01-listening-before-speaking.20260810T091000Z.json).
    // Plant disagreeing values on BOTH progress.json fields this engine must never read.
    progress.chapters[0].last_gate = {
      ts: '2020-01-01T00:00:00Z',
      verdict: 'block',
      report: '.studio/gate/does-not-exist.json',
    };
    progress.chapters[0].drift_score = 99.9;
    writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf8');

    const result = spawnStatus(tmp, ['--json']);
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    const json = JSON.parse(result.stdout);
    const row = json.chapters.find((c) => c.slug === progress.chapters[0].slug);

    assert.equal(row.gate, 'pass', 'gate must come from the gate-directory report ("pass"), not progress.json last_gate ("block")');
    assert.equal(row.drift, 10.86, 'drift must come from the gate-directory report (10.86), not progress.json drift_score (99.9)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Golden-book values (spot-checked against the real committed fixture)
// ---------------------------------------------------------------------------

test('golden book (--json): chapter and totals figures match the committed fixture', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnStatus(tmp, ['--json']);
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    const json = JSON.parse(result.stdout);

    assert.equal(json.chapters.length, 2);

    const ch1 = json.chapters[0];
    assert.equal(ch1.slug, '01-listening-before-speaking');
    assert.equal(ch1.number, '01');
    assert.equal(ch1.title, 'Listening Before Speaking');
    assert.equal(ch1.status, 'drafted');
    assert.equal(ch1.wordCount, 528);
    assert.equal(ch1.openClaimCount, 0);
    assert.equal(ch1.drift, 10.86);
    assert.equal(ch1.gate, 'pass');
    assert.equal(ch1.reportPath, '.studio/gate/01-listening-before-speaking.20260810T091000Z.json');
    assert.equal(ch1.highlighted, false);

    const ch2 = json.chapters[1];
    assert.equal(ch2.slug, '02-finding-your-network');
    assert.equal(ch2.drift, null, 'chapter 2 has no gate report on record');
    assert.equal(ch2.gate, null);
    assert.equal(ch2.reportPath, null);

    assert.equal(json.totals.wordCount, 1055);
    assert.equal(json.totals.openClaimCount, 0);
    assert.equal(json.totals.chaptersFinal, 0);
    assert.equal(json.totals.chaptersTotal, 6);
    assert.equal(json.totals.chaptersRemaining, 6);

    assert.equal(json.wholeBookGate, null, 'no all.<ts>.json report is committed in the fixture');
    assert.equal(json.thresholds.driftScoreMax, 25);
    assert.equal(json.thresholds.driftScoreMaxIsDefault, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('golden book (default mode): renders a Markdown board with both chapters and the totals row', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnStatus(tmp, []);
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    const out = result.stdout;
    assert.match(out, /01-listening-before-speaking|Listening Before Speaking/);
    assert.match(out, /Finding Your Network/);
    assert.match(out, /528/);
    assert.match(out, /pass/);
    assert.match(out, /1055/);
    assert.ok(!out.toLowerCase().includes(FORBIDDEN_TIER_WORD), 'board text must never use the reserved tier-climb word');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('neither output mode ever contains the reserved tier-climb word (controller Decision 3)', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const jsonResult = spawnStatus(tmp, ['--json']);
    const textResult = spawnStatus(tmp, []);
    assert.equal(jsonResult.status, 0, 'stderr: ' + jsonResult.stderr);
    assert.equal(textResult.status, 0, 'stderr: ' + textResult.stderr);
    assert.ok(jsonResult.stdout.length > 0, 'precondition: json output is non-empty');
    assert.ok(textResult.stdout.length > 0, 'precondition: board output is non-empty');
    assert.ok(!jsonResult.stdout.toLowerCase().includes(FORBIDDEN_TIER_WORD));
    assert.ok(!textResult.stdout.toLowerCase().includes(FORBIDDEN_TIER_WORD));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('neither output mode ever leaks the temp clone\'s absolute filesystem path', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const jsonResult = spawnStatus(tmp, ['--json']);
    const textResult = spawnStatus(tmp, []);
    assert.equal(jsonResult.status, 0, 'stderr: ' + jsonResult.stderr);
    assert.equal(textResult.status, 0, 'stderr: ' + textResult.stderr);
    assert.ok(jsonResult.stdout.length > 0, 'precondition: json output is non-empty');
    assert.ok(textResult.stdout.length > 0, 'precondition: board output is non-empty');
    assert.ok(!jsonResult.stdout.includes(tmp), 'json output must use book-relative paths only');
    assert.ok(!textResult.stdout.includes(tmp), 'board output must use book-relative paths only');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Whole-book gate annotation (synthetic: the golden fixture ships none)
// ---------------------------------------------------------------------------

test('a whole-book all.<ts>.json report annotates wholeBookGate in --json output', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const allReport = {
      version: 2, chapter: 'all', ts: '2026-08-11T00:00:00Z', verdict: 'warn', checks: [],
    };
    writeFileSync(join(tmp, '.studio', 'gate', 'all.20260811T000000Z.json'), JSON.stringify(allReport), 'utf8');

    const result = spawnStatus(tmp, ['--json']);
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.wholeBookGate, 'warn');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --project flag resolution
// ---------------------------------------------------------------------------

test('--project=<dir> resolves the book root independent of process cwd', () => {
  const tmp = makeTempClone(GOLDEN);
  const elsewhere = mkdtempSync(join(os.tmpdir(), 'ns-status-elsewhere-'));
  try {
    const result = spawnStatus(elsewhere, ['--project=' + tmp, '--json']);
    assert.equal(result.status, 0, 'stderr: ' + result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.chapters.length, 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Exit-2 operational-error taxonomy: missing book root, bad flag, malformed
// progress.json. Every message carries the CLI's own name.
// ---------------------------------------------------------------------------

test('exit 2: no book root found; stderr names the CLI', () => {
  const bareDir = mkdtempSync(join(os.tmpdir(), 'ns-status-bare-'));
  try {
    const result = spawnStatus(bareDir, []);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^ns-status:/);
    assert.match(result.stderr, /No book root found/);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(bareDir, { recursive: true, force: true });
  }
});

test('exit 2: an unknown flag; stderr names the CLI', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    const result = spawnStatus(tmp, ['--bogus-flag-nobody-defined']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^ns-status:/);
    assert.match(result.stderr, /Unknown flag/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('exit 2: malformed progress.json; stderr names the CLI', () => {
  const tmp = makeTempClone(GOLDEN);
  try {
    writeFileSync(join(tmp, '.studio', 'progress.json'), '{ this is not valid JSON', 'utf8');
    const result = spawnStatus(tmp, []);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^ns-status:/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
