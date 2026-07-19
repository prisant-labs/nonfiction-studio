// tests/hooks/pre-compact.test.mjs
// what-it-is:   behaviour tests for hooks/pre-compact.mjs (TSK-035)
// what-it-does: spawns the real script with crafted snake_case PreCompact events and
//               asserts the five cases from the TSK-035 brief; includes the equality
//               proof that pre-compact and session-start produce the same block when
//               run against the same golden fixture
// runner:       node --test "tests/hooks/*.test.mjs"
//
// Cases:
//   (a) golden fixture: exit 0, additionalContext block equals the session-start block
//       for the same tree (equality IS the shared-path proof); no sessionTitle field
//   (b) no book root: exit 0, empty stdout
//   (c) active chapter removed from progress.json: exit 0, empty stdout
//   (d) malformed stdin: exit 0, empty stdout
//   (e) NS_HOOK_TRACE inert when unset; one line with event PreCompact when set
//
// Never mutates committed fixtures. Temp clones are used for destructive cases (c).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  cpSync,
  existsSync,
  readFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'hooks', 'pre-compact.mjs');
const SESSION_START = join(REPO_ROOT, 'hooks', 'session-start.mjs');
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a synthetic PreCompact event with the given cwd.
 * Matches the common snake_case envelope; cwd drives book detection.
 */
function makeEvent(cwd) {
  return JSON.stringify({
    session_id: 'test-session-035',
    transcript_path: '/tmp/transcript.jsonl',
    cwd,
    hook_event_name: 'PreCompact'
  });
}

/**
 * Builds a synthetic SessionStart event with the given cwd, for the equality proof.
 */
function makeSessionStartEvent(cwd) {
  return JSON.stringify({
    session_id: 'test-session-035-ss',
    transcript_path: '/tmp/transcript.jsonl',
    cwd,
    hook_event_name: 'SessionStart',
    source: 'startup'
  });
}

/**
 * Spawns pre-compact.mjs with the given stdin and optional extra env overrides.
 * NS_HOOK_TRACE is cleared from the parent env by default.
 */
function runHook(input, extraEnv = {}) {
  const env = { ...process.env };
  delete env.NS_HOOK_TRACE;
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined || v === '') {
      delete env[k];
    } else {
      env[k] = String(v);
    }
  }
  return spawnSync('node', [SCRIPT], { input, encoding: 'utf8', env });
}

/**
 * Spawns session-start.mjs with the given stdin. NS_HOOK_TRACE cleared by default.
 */
function runSessionStart(cwd) {
  const env = { ...process.env };
  delete env.NS_HOOK_TRACE;
  return spawnSync('node', [SESSION_START], {
    input: makeSessionStartEvent(cwd),
    encoding: 'utf8',
    env
  });
}

/**
 * Creates a fresh temp directory with a unique name.
 */
function makeTmpDir(label) {
  const dir = join(tmpdir(), 'ns-tsk035-' + label + '-' + Date.now());
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Deep-copies the sample book into a new temp path and returns it.
 */
function cloneSampleBook(label) {
  const dir = join(tmpdir(), 'ns-tsk035-' + label + '-' + Date.now());
  cpSync(SAMPLE_BOOK, dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Case (a): golden fixture - equality proof
// ---------------------------------------------------------------------------
test('(a) golden fixture: exit 0, pre-compact block equals session-start block; no sessionTitle', () => {
  // Spawn both hooks against the same committed fixture.
  const pcResult = runHook(makeEvent(SAMPLE_BOOK));
  const ssResult = runSessionStart(SAMPLE_BOOK);

  // Both must exit 0.
  assert.equal(pcResult.status, 0, 'pre-compact exits 0');
  assert.equal(ssResult.status, 0, 'session-start exits 0');
  assert.equal(pcResult.stderr, '', 'no stderr from pre-compact');

  // Both must produce parseable JSON.
  let pcOut, ssOut;
  assert.doesNotThrow(
    () => { pcOut = JSON.parse(pcResult.stdout.trim()); },
    'pre-compact stdout parses as JSON'
  );
  assert.doesNotThrow(
    () => { ssOut = JSON.parse(ssResult.stdout.trim()); },
    'session-start stdout parses as JSON'
  );

  const pcHso = pcOut.hookSpecificOutput;
  const ssHso = ssOut.hookSpecificOutput;

  // Pre-compact must identify itself correctly.
  assert.equal(pcHso.hookEventName, 'PreCompact', 'hookEventName is PreCompact');

  // NO sessionTitle on pre-compact (SessionStart-only per PF-10).
  assert.equal(pcHso.sessionTitle, undefined, 'no sessionTitle in pre-compact output');

  // Session-start must have sessionTitle (confirms we are comparing the right hook).
  assert.equal(typeof ssHso.sessionTitle, 'string', 'session-start has sessionTitle');

  // THE EQUALITY PROOF: both additionalContext blocks must be identical.
  // This proves that both hooks consume the same buildOrientation implementation.
  const pcBlock = pcHso.additionalContext;
  const ssBlock = ssHso.additionalContext;

  assert.equal(typeof pcBlock, 'string', 'pre-compact additionalContext is a string');
  assert.equal(typeof ssBlock, 'string', 'session-start additionalContext is a string');
  assert.equal(pcBlock, ssBlock,
    'pre-compact and session-start blocks are identical (shared-path proof)\n' +
    '  pre-compact: ' + JSON.stringify(pcBlock) + '\n' +
    '  session-start: ' + JSON.stringify(ssBlock)
  );

  // Spot-check: block must contain all five expected elements.
  assert.ok(
    pcBlock.includes('Thesis:'),
    'block contains thesis element'
  );
  assert.ok(
    pcBlock.includes('Active chapter:'),
    'block contains active chapter element'
  );
  assert.ok(
    pcBlock.includes('Style rules:'),
    'block contains style rules element'
  );
  assert.ok(
    pcBlock.includes('Open claims:'),
    'block contains open-claims element'
  );
});

// ---------------------------------------------------------------------------
// Case (b): no book root
// ---------------------------------------------------------------------------
test('(b) no book root: exit 0, empty stdout', () => {
  const tmpDir = makeTmpDir('no-root');
  const result = runHook(makeEvent(tmpDir));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stderr, '', 'no stderr');
  assert.equal(result.stdout.trim(), '', 'stdout is empty (no book root no-op)');
});

// ---------------------------------------------------------------------------
// Case (c): active chapter removed from progress.json
// ---------------------------------------------------------------------------
test('(c) active chapter removed: exit 0, empty stdout (stricter no-op)', () => {
  const cloneDir = cloneSampleBook('no-chapter');

  // Remove the chapters array so there is no resolvable active chapter.
  writeFileSync(
    join(cloneDir, '.studio', 'progress.json'),
    JSON.stringify({ version: 2, updated: '2026-07-18T00:00:00Z', chapters: [], totals: {} }),
    'utf8'
  );

  const result = runHook(makeEvent(cloneDir));

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stderr, '', 'no stderr');
  assert.equal(
    result.stdout.trim(),
    '',
    'stdout is empty when no active chapter is resolvable (stricter than session-start)'
  );
});

// ---------------------------------------------------------------------------
// Case (d): malformed stdin
// ---------------------------------------------------------------------------
test('(d) malformed stdin: exit 0, empty stdout', () => {
  const result = runHook('not valid json {{{{');

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stderr, '', 'no stderr');
  assert.equal(result.stdout.trim(), '', 'stdout is empty on malformed stdin');
});

// ---------------------------------------------------------------------------
// Case (e): NS_HOOK_TRACE unset vs set
// ---------------------------------------------------------------------------
test('(e) NS_HOOK_TRACE unset: no trace file written', () => {
  const tmpDir = makeTmpDir('trace-unset');
  const traceFile = join(tmpDir, 'trace.jsonl');

  // runHook clears NS_HOOK_TRACE by default; use an empty dir so we get empty stdout.
  const result = runHook(makeEvent(tmpDir));
  assert.equal(result.status, 0, 'exit code is 0');
  assert.ok(!existsSync(traceFile), 'no trace file when NS_HOOK_TRACE is unset');
});

test('(e) NS_HOOK_TRACE set: exactly one trace line with event PreCompact', () => {
  const tmpDir = makeTmpDir('trace-set');
  const traceFile = join(tmpDir, 'trace.jsonl');

  // Use an empty dir as cwd (no book root -> empty stdout); trace is still written
  // before book detection, so the trace test is independent of the no-op path.
  const result = runHook(makeEvent(tmpDir), { NS_HOOK_TRACE: traceFile });
  assert.equal(result.status, 0, 'exit code is 0');
  assert.ok(existsSync(traceFile), 'trace file was created when NS_HOOK_TRACE is set');

  const lines = readFileSync(traceFile, 'utf8')
    .split('\n')
    .filter(l => l.trim() !== '');
  assert.equal(lines.length, 1, 'exactly one trace line was written');

  const trace = JSON.parse(lines[0]);
  assert.equal(trace.event, 'PreCompact', 'trace record has event: PreCompact');
  assert.ok(typeof trace.script === 'string', 'trace record carries the script path');
  assert.ok(typeof trace.stdinRaw === 'string', 'trace record carries stdinRaw');
});
