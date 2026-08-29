// tests/hooks/session-start.test.mjs
// what-it-is:   behaviour tests for hooks/session-start.mjs (TSK-031)
// what-it-does: spawns the real script with crafted snake_case SessionStart events and
//               asserts the six cases from the TSK-031 brief
// runner:       node --test "tests/hooks/*.test.mjs"
//
// Synthetic events copy the shape captured live in the TSK-030 report (snake_case stdin):
//   { session_id, transcript_path, cwd, hook_event_name, source }
//
// Never mutates committed fixtures. Temp clones are used for destructive cases (c, d, e).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  cpSync,
  existsSync,
  readFileSync,
  utimesSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'hooks', 'session-start.mjs');
const SAMPLE_BOOK = join(REPO_ROOT, 'examples', 'sample-book');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a synthetic SessionStart event with the given cwd (snake_case shape
 * matching the live-captured platform event from the TSK-030 report).
 */
function makeEvent(cwd) {
  return JSON.stringify({
    session_id: 'test-session-001',
    transcript_path: '/tmp/transcript.jsonl',
    cwd,
    hook_event_name: 'SessionStart',
    source: 'startup'
  });
}

/**
 * Spawns the hook with the given cwd and optional extra env overrides.
 * NS_HOOK_TRACE is cleared from the parent env by default so tests do not
 * inherit a trace path from the developer environment.
 */
function runHook(cwd, extraEnv = {}) {
  const env = { ...process.env };
  delete env.NS_HOOK_TRACE;

  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined || v === '') {
      delete env[k];
    } else {
      env[k] = String(v);
    }
  }

  return spawnSync('node', [SCRIPT], {
    input: makeEvent(cwd),
    encoding: 'utf8',
    env
  });
}

/**
 * Creates a fresh temp directory with a unique name.
 */
function makeTmpDir(label) {
  const dir = join(tmpdir(), 'ns-tsk031-' + label + '-' + Date.now());
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Deep-copies the sample book into a new temp path and returns it.
 * The dest path does not pre-exist so cpSync creates it as a mirror of SAMPLE_BOOK.
 */
function cloneSampleBook(label) {
  const dir = join(tmpdir(), 'ns-tsk031-' + label + '-' + Date.now());
  cpSync(SAMPLE_BOOK, dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Case (a): golden fixture cwd
// ---------------------------------------------------------------------------
test('(a) golden fixture: exit 0, five elements present, correct sessionTitle', () => {
  const result = runHook(SAMPLE_BOOK);

  assert.equal(result.status, 0, 'exit code is 0');
  assert.equal(result.stderr, '', 'no stderr');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const hso = out.hookSpecificOutput;
  assert.ok(hso, 'output has hookSpecificOutput');
  assert.equal(hso.hookEventName, 'SessionStart', 'hookEventName is SessionStart');

  // sessionTitle from meta.json book_title
  assert.equal(hso.sessionTitle, 'The Quiet Network', 'sessionTitle matches fixture book_title');

  const ctx = hso.additionalContext;
  assert.equal(typeof ctx, 'string', 'additionalContext is a string');

  // Thesis: exact text from context/brief.md section 2 heading
  assert.ok(
    ctx.includes('Building a personal learning network is a deliberate'),
    'additionalContext includes thesis text from brief.md'
  );

  // Active chapter slug from progress.json (last working-status chapter in the fixture)
  assert.ok(
    ctx.includes('02-finding-your-network'),
    'additionalContext includes the active chapter slug'
  );

  // Style rule: first bullet under "## Do" in style-profile.md
  assert.ok(
    ctx.includes('open sections with a concrete question'),
    'additionalContext includes a style rule from the Do section'
  );

  // Open-claims count: all 10 fixture entries have status verified or interpretation = 0 open
  assert.ok(
    ctx.includes('Open claims: 0'),
    'additionalContext includes open-claims count of 0 matching the fixture ledger'
  );
});

// ---------------------------------------------------------------------------
// Case (b): empty scratch directory
// ---------------------------------------------------------------------------
test('(b) empty scratch dir: exit 0, exactly two-sentence empty-state, no sessionTitle', () => {
  const tmpDir = makeTmpDir('empty');
  const result = runHook(tmpDir);

  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const hso = out.hookSpecificOutput;
  const ctx = hso.additionalContext;

  assert.equal(typeof ctx, 'string', 'additionalContext is a string');

  // Sentence count: split on ". " gives exactly two parts
  const parts = ctx.split('. ');
  assert.equal(parts.length, 2, 'empty-state contains exactly two sentences (split on ". ")');
  assert.ok(ctx.endsWith('.'), 'empty-state ends with a period');

  // Content: first sentence mentions no book project; second names nfs-new-book
  assert.ok(ctx.includes('No book project'), 'first sentence mentions no book project');
  assert.ok(ctx.includes('nfs-new-book'), 'second sentence names the nfs-new-book flow');

  // No sessionTitle on empty-state path
  assert.equal(hso.sessionTitle, undefined, 'sessionTitle is absent on empty-state path');
});

// ---------------------------------------------------------------------------
// Case (c): stale last-gate (ts older than a touched chapter)
// ---------------------------------------------------------------------------
test('(c) stale last-gate: gate-debt line is present', () => {
  const cloneDir = cloneSampleBook('stale-gate');

  // Overwrite last-gate.json with a ts in the distant past.
  // Flat shape (F-HK-02): {version, chapter, ts, verdict, checks} is the real
  // S-08 section 11 report shape written verbatim by hooks/stop-gate.mjs -
  // NOT a per-chapter map keyed by slug.
  const gateDir = join(cloneDir, '.studio', 'gate');
  writeFileSync(
    join(gateDir, 'last-gate.json'),
    JSON.stringify({
      version: 2,
      chapter: '01-listening-before-speaking',
      ts: '2020-01-01T00:00:00Z',
      verdict: 'pass',
      checks: []
    }),
    'utf8'
  );

  // Touch a chapter file to make its mtime definitively newer than the stale gate ts.
  const chapterFile = join(cloneDir, 'chapters', '01-listening-before-speaking.md');
  const now = new Date();
  utimesSync(chapterFile, now, now);

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes('Gate debt'), 'orientation block contains a gate-debt line');
  assert.ok(ctx.includes('run-quality-gate'), 'gate-debt line points at run-quality-gate');
});

// ---------------------------------------------------------------------------
// Case (d): fresh last-gate (ts far in the future, newer than all chapters)
// ---------------------------------------------------------------------------
test('(d) fresh last-gate: no gate-debt line', () => {
  const cloneDir = cloneSampleBook('fresh-gate');

  // Overwrite last-gate.json with a ts far in the future.
  // Flat shape (F-HK-02): see the case (c) comment above.
  const gateDir = join(cloneDir, '.studio', 'gate');
  writeFileSync(
    join(gateDir, 'last-gate.json'),
    JSON.stringify({
      version: 2,
      chapter: '01-listening-before-speaking',
      ts: '2099-12-31T23:59:59Z',
      verdict: 'pass',
      checks: []
    }),
    'utf8'
  );

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(!ctx.includes('Gate debt'), 'no gate-debt line when last-gate is newer than all chapters');
});

// ---------------------------------------------------------------------------
// Case (e): malformed progress.json
// ---------------------------------------------------------------------------
test('(e) malformed progress.json: exit 0, partial block, exactly one error line', () => {
  const cloneDir = cloneSampleBook('malformed-progress');

  // Corrupt progress.json with non-JSON content.
  writeFileSync(join(cloneDir, '.studio', 'progress.json'), 'not valid json {{', 'utf8');

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0 despite malformed progress.json');

  // stdout must still parse as valid JSON
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const ctx = out.hookSpecificOutput.additionalContext;

  // Thesis should still be present (brief.md is intact in the clone)
  assert.ok(
    ctx.includes('Building a personal learning network is a deliberate'),
    'thesis is still present in the partial orientation block'
  );

  // Errors log must be created with exactly one entry (the progress.json failure).
  const errorsPath = join(cloneDir, '.studio', 'logs', 'errors.jsonl');
  assert.ok(existsSync(errorsPath), 'errors.jsonl was created by the fail-open handler');

  const errLines = readFileSync(errorsPath, 'utf8')
    .split('\n')
    .filter(l => l.trim() !== '');
  assert.equal(errLines.length, 1, 'exactly one error line was appended to errors.jsonl');

  const errRecord = JSON.parse(errLines[0]);
  assert.equal(errRecord.hook, 'SessionStart', 'error record identifies hook: SessionStart');
  assert.ok(typeof errRecord.msg === 'string', 'error record carries a msg string');
  assert.ok(typeof errRecord.err === 'string', 'error record carries an err string');
});

// ---------------------------------------------------------------------------
// Case (g): corrupt meta.json - TSK-034 (stop-gate hook) error-code discrimination
// ---------------------------------------------------------------------------
test('(g) corrupt meta.json: exit 0, truthful one-line message, no sessionTitle', () => {
  const cloneDir = cloneSampleBook('corrupt-meta');

  writeFileSync(join(cloneDir, '.studio', 'meta.json'), 'not valid json {{', 'utf8');

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0 despite corrupt meta.json');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const hso = out.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'SessionStart', 'hookEventName is SessionStart');

  const ctx = hso.additionalContext;
  assert.equal(typeof ctx, 'string', 'additionalContext is a string');

  // Truthful: names the real problem, not the misleading "no book project" text.
  assert.ok(!ctx.includes('No book project'), 'message does not claim no book project exists');
  assert.ok(ctx.includes('meta.json'), 'message names meta.json as the real problem');

  // No sessionTitle on this path (meta could not be read).
  assert.equal(hso.sessionTitle, undefined, 'sessionTitle is absent when meta.json is corrupt');
});

// ---------------------------------------------------------------------------
// Case (h): corrupt config.json - TSK-034 (stop-gate hook) error-code discrimination
// ---------------------------------------------------------------------------
test('(h) corrupt config.json: exit 0, truthful one-line message, no sessionTitle', () => {
  const cloneDir = cloneSampleBook('corrupt-config');

  writeFileSync(join(cloneDir, '.studio', 'config.json'), 'not valid json {{', 'utf8');

  const result = runHook(cloneDir);
  assert.equal(result.status, 0, 'exit code is 0 despite corrupt config.json');

  let out;
  assert.doesNotThrow(() => { out = JSON.parse(result.stdout.trim()); }, 'stdout parses as JSON');

  const hso = out.hookSpecificOutput;
  assert.equal(hso.hookEventName, 'SessionStart', 'hookEventName is SessionStart');

  const ctx = hso.additionalContext;
  assert.equal(typeof ctx, 'string', 'additionalContext is a string');

  // Truthful: names the real problem, not the misleading "no book project" text.
  assert.ok(!ctx.includes('No book project'), 'message does not claim no book project exists');
  assert.ok(ctx.includes('config.json'), 'message names config.json as the real problem');

  // No sessionTitle on this path (root detection threw before orientation ran).
  assert.equal(hso.sessionTitle, undefined, 'sessionTitle is absent when config.json is corrupt');
});

// ---------------------------------------------------------------------------
// Case (f): NS_HOOK_TRACE unset vs set
// ---------------------------------------------------------------------------
test('(f) NS_HOOK_TRACE unset: no trace file written', () => {
  const tmpDir = makeTmpDir('trace-unset');
  const traceFile = join(tmpDir, 'trace.jsonl');

  // runHook clears NS_HOOK_TRACE by default; empty dir gives empty-state path, which is fine.
  const result = runHook(tmpDir);
  assert.equal(result.status, 0, 'exit code is 0');
  assert.ok(!existsSync(traceFile), 'no trace file exists when NS_HOOK_TRACE is unset');
});

test('(f) NS_HOOK_TRACE set: exactly one trace line written with correct event name', () => {
  const tmpDir = makeTmpDir('trace-set');
  const traceFile = join(tmpDir, 'trace.jsonl');

  const result = runHook(tmpDir, { NS_HOOK_TRACE: traceFile });
  assert.equal(result.status, 0, 'exit code is 0');
  assert.ok(existsSync(traceFile), 'trace file was created when NS_HOOK_TRACE is set');

  const lines = readFileSync(traceFile, 'utf8')
    .split('\n')
    .filter(l => l.trim() !== '');
  assert.equal(lines.length, 1, 'exactly one trace line was written');

  const trace = JSON.parse(lines[0]);
  assert.equal(trace.event, 'SessionStart', 'trace record has event: SessionStart');
  assert.ok(typeof trace.script === 'string', 'trace record carries the script path');
  assert.ok(typeof trace.stdinRaw === 'string', 'trace record carries stdinRaw');
});
